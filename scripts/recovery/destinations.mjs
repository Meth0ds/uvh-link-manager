import { open, rename, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fail, directory, regular } from './store.mjs';
import { digestFile, hashStream } from './backup-format.mjs';
import { createS3Transport, verifyRemote, discardResponse } from './s3-transport.mjs';
import { PART_SIZE, readExactly, uploadMultipart } from './s3-multipart.mjs';

function validId(value) { if (!/^[a-f0-9-]{36}$/.test(value ?? '')) fail('invalid_destination', 'Destino no válido.', 400); }

export async function copyToFolder(source, destination, id, options = {}) {
  validId(id); regular(source); directory(destination);
  const target = join(destination, `${id}.uvh.enc`), temp = `${target}.uploading`;
  if (existsSync(temp) || (existsSync(target) && lstatSync(target).isSymbolicLink())) fail('destination_busy', 'El destino externo tiene una transferencia pendiente.', 409);
  const expectedDigest = options.digest ?? null, bytes = (await stat(source)).size;
  let owned = false, handle = null;
  try {
    // Reserve the temporary path before opening the pipeline. The source is
    // read once and its digest is calculated from the same bytes written out.
    handle = await open(temp, 'wx', 0o600); owned = true;
    const hashing = hashStream();
    await pipeline(createReadStream(source), hashing.stream, handle.createWriteStream({ autoClose: true }));
    const digest = hashing.digest();
    if ((await stat(temp)).size !== bytes || (expectedDigest !== null && digest !== expectedDigest)) fail('destination_integrity', 'La copia externa no coincide con su huella.', 503);
    await handle.close(); handle = null;
    await rename(temp, target); owned = false;
    return { key: `${id}.uvh.enc`, bytes, digest };
  } finally {
    await handle?.close().catch(() => {});
    if (owned) await unlink(temp).catch(() => {});
  }
}

export async function copyToS3(source, config, id, fetcher = fetch, options = {}) {
  validId(id); regular(source);
  if (!config.bucket || !config.region || !config.accessKey || !config.secretKey) fail('destination_credentials', 'Faltan credenciales del destino externo.', 422);
  const metadata = await stat(source), digest = options.digest ?? await digestFile(source);
  const prefix = String(config.prefix ?? '').replace(/^\/+|\/+$/g, '');
  const key = `${prefix ? `${prefix}/` : ''}${id}.uvh.enc`;
  const request = createS3Transport(config, fetcher, options.clock);
  const threshold = Number.isSafeInteger(config.multipartThreshold) ? Math.min(Math.max(config.multipartThreshold, 1), PART_SIZE) : PART_SIZE;
  if (metadata.size > threshold) return uploadMultipart(source, config, key, metadata.size, digest, request, options);
  const handle = await open(source); let body;
  try { body = await readExactly(handle, 0, metadata.size); }
  finally { await handle.close(); }
  await discardResponse(await request('PUT', key, body));
  await verifyRemote(request, key, body.length, digest);
  return { key, bytes: body.length, digest, multipart: false, parts: 1 };
}

export async function sync(source, config, id, options = {}) {
  if (config.type === 'folder') return copyToFolder(source, config.path, id, options);
  if (config.type === 's3') return copyToS3(source, config, id, options.fetcher, options);
  fail('invalid_destination', 'Tipo de destino externo no admitido.', 400);
}
