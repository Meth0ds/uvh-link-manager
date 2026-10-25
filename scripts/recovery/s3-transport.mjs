import { createHash } from 'node:crypto';
import { signedRequest } from './s3-signing.mjs';
import { fail, RecoveryError } from './store.mjs';

export async function discardResponse(response) {
  try { await response.body?.cancel(); } catch { /* Cleanup must preserve the primary transport result. */ }
}

export function createS3Transport(config, fetcher = fetch, clock = Date.now) {
  return async (method, key, body = Buffer.alloc(0), query = {}, contentType = 'application/octet-stream') => {
    const signed = signedRequest(config, method, key, body, query, new Date(clock()));
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(method);
    const response = await fetcher(signed.url, { method, redirect: 'error',
      headers: { ...signed.headers, ...(hasBody ? { 'Content-Length': String(body.length), 'Content-Type': contentType } : {}) },
      ...(hasBody ? { body } : {}), signal: AbortSignal.timeout(120000) });
    if (!response.ok) {
      await discardResponse(response);
      const error = new RecoveryError('destination_upload', `El destino externo rechazó la copia (HTTP ${response.status}).`, 503);
      error.httpStatus = response.status;
      throw error;
    }
    return response;
  };
}

export async function responseText(response, limit = 1024 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > limit) fail('destination_protocol', 'El destino externo devolvió una respuesta demasiado grande.', 503);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function verifyRemote(request, key, bytes, digest) {
  const response = await request('GET', key);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== bytes) {
    await discardResponse(response);
    fail('destination_integrity', 'El tamaño de la copia externa no coincide.', 503);
  }
  const hash = createHash('sha256'); let received = 0;
  for await (const chunk of response.body ?? []) {
    received += chunk.length;
    if (received > bytes) fail('destination_integrity', 'El tamaño de la copia externa no coincide.', 503);
    hash.update(chunk);
  }
  if (received !== bytes || hash.digest('hex') !== digest) fail('destination_integrity', 'La copia externa no coincide con su huella.', 503);
}
