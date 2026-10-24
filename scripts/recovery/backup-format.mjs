import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fail, regular } from './store.mjs';

export const FORMAT_SCHEMA = 2;
export const COMPONENTS = ['configuration.json', 'database.dump', 'release.json', 'source.bundle', 'storage.tar'];

export async function digestFile(path) {
  regular(path);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export async function createManifest(folder, release) {
  const components = {};
  for (const name of COMPONENTS) {
    const path = `${folder}/${name}`;
    const metadata = await stat(path);
    components[name] = { bytes: metadata.size, sha256: await digestFile(path) };
  }
  const manifest = { schema: FORMAT_SCHEMA, tool: 'uvh-recovery', createdAt: new Date().toISOString(), sourceSha: release.sha, releaseSchema: release.schema, components };
  await writeFile(`${folder}/manifest.json`, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
  return manifest;
}

export async function validateManifest(folder, { allowLegacy = true } = {}) {
  const path = `${folder}/manifest.json`;
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest.schema !== FORMAT_SCHEMA || manifest.tool !== 'uvh-recovery' || typeof manifest.components !== 'object') fail('invalid_manifest', 'El manifiesto de backup no es compatible.');
    for (const name of COMPONENTS) {
      const component = manifest.components[name];
      if (!component || !Number.isSafeInteger(component.bytes) || component.bytes < 0 || !/^[a-f0-9]{64}$/.test(component.sha256)) fail('invalid_manifest', 'El manifiesto de backup está incompleto.');
      const metadata = await stat(`${folder}/${name}`);
      if (metadata.size !== component.bytes || await digestFile(`${folder}/${name}`) !== component.sha256) fail('backup_integrity', `El componente ${name} no coincide con su manifiesto.`);
    }
    return manifest;
  } catch (error) {
    if (allowLegacy && error?.code === 'ENOENT') return { schema: 1, legacy: true };
    throw error;
  }
}
