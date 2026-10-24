import { copyFile, open, rename, stat, unlink } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { fail, directory, regular, atomic, read } from './store.mjs';

const PART_SIZE = 8 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function validId(value) { if (!/^[a-f0-9-]{36}$/.test(value ?? '')) fail('invalid_destination', 'Destino no válido.', 400); }

export async function copyToFolder(source, destination, id) {
  validId(id); directory(destination);
  const target = join(destination, `${id}.uvh.enc`), temp = `${target}.uploading`;
  if (existsSync(temp) || (existsSync(target) && lstatSync(target).isSymbolicLink())) fail('destination_busy', 'El destino externo tiene una transferencia pendiente.', 409);
  try {
    await copyFile(source, temp); regular(temp); await rename(temp, target);
  } catch (error) {
    try { await unlink(temp); } catch { /* The failed copy may not have created a temp file. */ }
    throw error;
  }
  return { key: `${id}.uvh.enc`, bytes: (await stat(target)).size, digest: await digestFile(target) };
}

async function digestFile(path) {
  regular(path); const digest = createHash('sha256'); const handle = await open(path);
  try { for await (const chunk of handle.readableWebStream()) digest.update(Buffer.from(chunk)); }
  finally { await handle.close(); }
  return digest.digest('hex');
}

function s3Path(config, id) { const prefix = String(config.prefix ?? '').replace(/^\/+|\/+$/g, ''); return `${prefix ? `${prefix}/` : ''}${id}.uvh.enc`; }
function signingKey(secret, date, region, service) { return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request'); }
function canonicalQuery(query = {}) {
  return Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value ?? '')}`).join('&');
}
function endpointFor(config) {
  const endpoint = new URL(config.endpoint), hostname = endpoint.hostname.toLowerCase(), ip = isIP(hostname);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || hostname === 'localhost' || ip === 4 && hostname.startsWith('127.') || ip === 6 && (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1')) fail('invalid_destination', 'El destino externo debe usar HTTPS, un host dedicado y no incluir credenciales en la URL.');
  return endpoint;
}
function signedRequest(config, method, key, body, query = {}, clock = new Date()) {
  const endpoint = endpointFor(config), host = endpoint.host;
  const path = `${endpoint.pathname.replace(/\/$/, '')}/${config.bucket}/${key}`.split('/').map(encodeURIComponent).join('/'), queryString = canonicalQuery(query);
  const payloadHash = sha256(body), amzDate = clock.toISOString().replace(/[:-]|\.\d{3}/g, '') + 'Z', short = amzDate.slice(0, 8), service = 's3';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = `${method}\n${path}\n${queryString}\n${canonicalHeaders}\n${signed}\n${payloadHash}`;
  const scope = `${short}/${config.region}/${service}/aws4_request`, string = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = hmac(signingKey(config.secretKey, short, config.region, service), string).toString('hex');
  return { url: `${endpoint.origin}${path}${queryString ? `?${queryString}` : ''}`, headers: { Host: host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` } };
}
async function request(fetcher, config, method, key, body, query = {}, contentType = 'application/octet-stream') {
  const request = signedRequest(config, method, key, body, query);
  const response = await fetcher(request.url, { method, headers: { ...request.headers, 'Content-Length': String(body.length), 'Content-Type': contentType }, body, signal: AbortSignal.timeout(120000) });
  if (!response.ok) fail('destination_upload', `El destino externo rechazó la copia (HTTP ${response.status}).`, 503);
  return response;
}
async function readPart(handle, start, size) {
  const buffer = Buffer.allocUnsafe(size); let offset = 0;
  while (offset < size) { const result = await handle.read(buffer, offset, size - offset, start + offset); if (!result.bytesRead) break; offset += result.bytesRead; }
  return buffer.subarray(0, offset);
}
async function copyToS3Multipart(source, config, id, fetcher, onProgress, statePath) {
  const key = s3Path(config, id), handle = await open(source), metadata = await stat(source);
  let state = statePath && read(statePath, null);
  const maxParts = Math.ceil(metadata.size / PART_SIZE);
  if (state && (state.schema !== 1 || state.key !== key || state.bytes !== metadata.size || typeof state.uploadId !== 'string' || state.uploadId.length > 512
    || !Array.isArray(state.parts) || state.parts.length > maxParts)) state = null;
  const parts = state?.parts ?? [];
  try {
    let uploadId = state?.uploadId;
    if (uploadId) {
      try {
        const listed = await request(fetcher, config, 'GET', key, Buffer.alloc(0), { uploadId }), listing = await listed.text();
        for (const match of listing.matchAll(/<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>"?([^<"]+)"?<\/ETag>\s*<\/Part>/gi)) parts[Number(match[1]) - 1] = { number: Number(match[1]), etag: match[2] };
      } catch { uploadId = null; parts.length = 0; }
    }
    if (!uploadId) {
      const initiated = await request(fetcher, config, 'POST', key, Buffer.alloc(0), { uploads: '' }), text = await initiated.text();
      uploadId = /<UploadId>([^<]+)<\/UploadId>/i.exec(text)?.[1];
    }
    if (!uploadId) fail('destination_protocol', 'El destino externo no devolvió un identificador de transferencia.', 503);
    if (statePath) { directory(dirname(statePath)); atomic(statePath, { schema: 1, uploadId, key, bytes: metadata.size, parts }); }
    try {
      for (let number = 1, position = 0; position < metadata.size; number++) {
        const existing = parts[number - 1]; if (existing?.etag) { position += Math.min(PART_SIZE, metadata.size - position); continue; }
        const body = await readPart(handle, position, Math.min(PART_SIZE, metadata.size - position));
        if (!body.length) break;
        const response = await request(fetcher, config, 'PUT', key, body, { partNumber: String(number), uploadId });
        const etag = response.headers.get('etag'); if (!etag) fail('destination_protocol', 'El destino externo no devolvió la huella de una parte.', 503);
        parts[number - 1] = { number, etag: etag.replaceAll('"', '') }; position += body.length; if (statePath) atomic(statePath, { schema: 1, uploadId, key, bytes: metadata.size, parts }); onProgress?.({ uploadId, part: number, bytes: position, total: metadata.size });
      }
      const xml = `<CompleteMultipartUpload>${parts.filter(Boolean).map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      await request(fetcher, config, 'POST', key, Buffer.from(xml), { uploadId }, 'application/xml');
      if (statePath) { try { await unlink(statePath); } catch { /* Completed state is best effort cleanup. */ } }
    } catch (error) {
      if (!statePath) { try { await request(fetcher, config, 'DELETE', key, Buffer.alloc(0), { uploadId }); } catch { /* Best effort; the circuit breaker records the failure. */ } }
      throw error;
    }
  } finally { await handle.close(); }
  return { key, bytes: metadata.size, digest: await digestFile(source), multipart: true, parts: parts.length };
}
export async function copyToS3(source, config, id, fetcher = fetch, options = {}) {
  validId(id); if (!config.bucket || !config.region || !config.accessKey || !config.secretKey) fail('destination_credentials', 'Faltan credenciales del destino externo.', 422);
  const metadata = await stat(source);
  const threshold = Number.isSafeInteger(config.multipartThreshold) ? Math.min(Math.max(config.multipartThreshold, 1), PART_SIZE) : PART_SIZE;
  if (metadata.size > threshold) return copyToS3Multipart(source, config, id, fetcher, options.onProgress, options.statePath);
  const body = Buffer.allocUnsafe(metadata.size), handle = await open(source);
  try { let offset = 0; while (offset < body.length) { const result = await handle.read(body, offset, body.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; } }
  finally { await handle.close(); }
  const key = s3Path(config, id); await request(fetcher, config, 'PUT', key, body);
  return { key, bytes: body.length, digest: sha256(body), multipart: false, parts: 1 };
}
export async function sync(source, config, id, options = {}) {
  if (config.type === 'folder') return copyToFolder(source, config.path, id);
  if (config.type === 's3') return copyToS3(source, config, id, options.fetcher, options);
  fail('invalid_destination', 'Tipo de destino externo no admitido.', 400);
}
