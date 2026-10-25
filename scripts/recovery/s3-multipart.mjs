import { open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomic, read, directory, fail, hash } from './store.mjs';
import { responseText, verifyRemote, discardResponse } from './s3-transport.mjs';

export const PART_SIZE = 8 * 1024 * 1024;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const decode = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
const field = (xml, name) => decode(new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? '');

export async function readExactly(handle, start, size) {
  const buffer = Buffer.alloc(size); let offset = 0;
  while (offset < size) {
    const result = await handle.read(buffer, offset, size - offset, start + offset);
    if (!result.bytesRead) fail('destination_source_changed', 'La copia local cambió durante la transferencia.', 409);
    offset += result.bytesRead;
  }
  return buffer;
}

async function confirmedParts(request, key, uploadId, bytes) {
  const parts = []; let marker = '';
  for (let page = 0; page < 11; page++) {
    const xml = await responseText(await request('GET', key, undefined, { uploadId, ...(marker ? { 'part-number-marker': marker } : {}) }));
    if (!/<ListPartsResult(?:\s|>)/.test(xml) || /<Error(?:\s|>)/.test(xml)) fail('destination_protocol', 'No se pudieron reconciliar las partes externas.', 503);
    for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const number = Number(field(match[1], 'PartNumber')), size = Number(field(match[1], 'Size')), etag = field(match[1], 'ETag');
      if (!Number.isInteger(number) || number < 1 || number > Math.ceil(bytes / PART_SIZE) || parts[number - 1]
          || size !== Math.min(PART_SIZE, bytes - (number - 1) * PART_SIZE) || !etag || etag.length > 256) fail('destination_protocol', 'Las partes externas no corresponden a la copia.', 503);
      parts[number - 1] = { number, etag };
    }
    if (field(xml, 'IsTruncated') !== 'true') return parts;
    const next = field(xml, 'NextPartNumberMarker');
    if (!/^\d+$/.test(next) || Number(next) <= Number(marker)) break;
    marker = next;
  }
  fail('destination_protocol', 'El listado de partes externas está incompleto.', 503);
}

export async function uploadMultipart(source, config, key, bytes, digest, request, { statePath, onProgress } = {}) {
  if (bytes > 10000 * PART_SIZE) fail('destination_size', 'La copia supera el límite de partes del destino.', 422);
  const identity = hash(JSON.stringify([config.endpoint, config.bucket, config.region, key, bytes, digest]));
  const saved = statePath ? read(statePath, null) : null;
  let uploadId = saved?.identity === identity && typeof saved.uploadId === 'string' && saved.uploadId.length <= 512 ? saved.uploadId : null;
  const forgetState = async () => {
    if (statePath) try { await unlink(statePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  if (uploadId) {
    // Completion may have committed even when its HTTP response was lost.
    // Verify that outcome before issuing another multipart mutation.
    try {
      await verifyRemote(request, key, bytes, digest);
      // If an equivalent object predates this attempt, its unfinished upload
      // may still exist. Abort only that owned upload; a completed ID is 404.
      try { await discardResponse(await request('DELETE', key, undefined, { uploadId })); }
      catch (error) { if (error.httpStatus !== 404) throw error; }
      await forgetState();
      return { key, bytes, digest, multipart: true, parts: Math.ceil(bytes / PART_SIZE) };
    } catch (error) { if (error.httpStatus !== 404) throw error; }
  }
  let parts = [], retained = Boolean(uploadId && statePath);
  const handle = await open(source);
  try {
    parts = uploadId ? await confirmedParts(request, key, uploadId, bytes) : [];
    if (!uploadId) {
      const xml = await responseText(await request('POST', key, undefined, { uploads: '' }));
      uploadId = field(xml, 'UploadId');
      if (!uploadId || uploadId.length > 512 || /<Error(?:\s|>)/.test(xml)) fail('destination_protocol', 'El destino externo no devolvió un identificador de transferencia.', 503);
    }
    const persist = () => { if (statePath) { directory(dirname(statePath)); atomic(statePath, { schema: 1, identity, uploadId, key, bytes, parts }); retained = true; } };
    persist();
    for (let number = 1, position = 0; position < bytes; number++) {
      const size = Math.min(PART_SIZE, bytes - position);
      if (!parts[number - 1]) {
        const body = await readExactly(handle, position, size);
        const response = await request('PUT', key, body, { partNumber: String(number), uploadId });
        await discardResponse(response);
        const etag = response.headers.get('etag');
        if (!etag || etag.length > 256) fail('destination_protocol', 'El destino externo no devolvió la huella de una parte.', 503);
        parts[number - 1] = { number, etag }; persist();
      }
      position += size; onProgress?.({ uploadId, part: number, bytes: position, total: bytes });
    }
    const xml = `<CompleteMultipartUpload>${parts.map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>${escape(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const result = await responseText(await request('POST', key, Buffer.from(xml), { uploadId }, 'application/xml'));
    if (!/<CompleteMultipartUploadResult(?:\s|\/?>)/.test(result) || /<Error(?:\s|>)/.test(result)) fail('destination_protocol', 'El destino externo no confirmó la transferencia completa.', 503);
    await verifyRemote(request, key, bytes, digest);
    await forgetState();
  } catch (error) {
    if (uploadId && !retained) { try { await discardResponse(await request('DELETE', key, undefined, { uploadId })); } catch { /* Preserve the primary error. */ } }
    throw error;
  } finally { await handle.close(); }
  return { key, bytes, digest, multipart: true, parts: parts.length };
}
