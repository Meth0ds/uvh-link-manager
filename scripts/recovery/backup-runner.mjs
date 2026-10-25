import { existsSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, fail } from './store.mjs';
import { sync as syncDestination } from './destinations.mjs';

export function createBackupRunner({ home, io, getConfig, data, now, clock, event, save, publish, backups, saveBackups, destinations, saveDestinations }) {
  function pathFor(id) {
    if (!/^[a-f0-9-]{36}$/.test(id ?? '')) fail('invalid_backup', 'Identificador de copia no válido.', 400);
    return join(getConfig().backupDir, `${id}.uvh.enc`);
  }
  async function withExtract(entry, callback) {
    const folder = directory(join(home, `extract-${randomUUID()}`));
    try { await io.unpack(entry, pathFor(entry.id), folder); return await callback(folder); }
    finally { rmSync(folder, { recursive: true, force: true }); }
  }
  async function verify(id) {
    const entries = backups(), entry = entries.find(value => value.id === id);
    if (!entry) fail('backup_missing', 'No existe esa copia.', 404);
    event('verifying_backup', 'Comprobando cifrado y restauración en una base aislada.');
    try {
      await withExtract(entry, folder => io.verify(folder));
      entry.integrityAt = now(); entry.restoredAt = now(); entry.error = null; saveBackups(entries); publish();
    } catch (error) { entry.restoredAt = null; entry.error = 'La verificación no se completó. La copia no es apta para restauración automática.'; saveBackups(entries); save(); throw error; }
    return entry;
  }
  async function backup(tag) {
    await io.clean();
    const sha = await io.head(), id = randomUUID(), folder = directory(join(home, `backup-${id}`));
    let persisted = false;
    event('backing_up', 'Creando una copia cifrada de base, archivos, configuración y código.');
    try {
      const space = statfsSync(getConfig().backupDir); if (space.bavail * space.bsize < 1024 ** 3) fail('disk_space', 'No hay espacio suficiente para una copia segura.');
      await io.backup(folder, sha);
      const crypt = await io.encrypt(folder, pathFor(id));
      const entry = { id, sha, category: tag, createdAt: now(), protected: false, integrityAt: null, restoredAt: null, ...crypt };
      saveBackups([...backups(), entry]); persisted = true; publish();
      const verified = await verify(id);
      const catalog = backups();
      const position = catalog.findIndex(value => value.id === id);
      catalog[position] = verified;
      const destinationValues = destinations(), external = destinationValues.filter(destination => destination.enabled !== false);
      if (!external.length) return verified;
      verified.external = external.map(destination => ({ id: destination.id, status: 'pending' })); saveBackups(catalog); save();
      for (const destination of external) {
        if (destination.retryAfter && Date.parse(destination.retryAfter) > clock()) {
          verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'circuit_open', retryAfter: destination.retryAfter } : item);
        } else {
          try {
            const result = await syncDestination(pathFor(id), destination, id, { statePath: join(home, 'multipart', `${destination.id}-${id}.json`), digest: verified.digest, clock }); destination.failureCount = 0; destination.retryAfter = null; destination.status = 'ready';
            verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'completed', bytes: result.bytes, digest: result.digest, completedAt: now(), multipart: result.multipart === true } : item);
          } catch (error) {
            destination.failureCount = (destination.failureCount ?? 0) + 1; destination.status = 'failed';
            if (destination.failureCount >= 3) destination.retryAfter = new Date(clock() + 15 * 60 * 1000).toISOString();
            verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'failed', error: error.code ?? 'destination_error', retryAfter: destination.retryAfter ?? null } : item);
          }
        }
        saveDestinations(destinationValues); saveBackups(catalog); save();
      }
      return verified;
    } catch (error) {
      if (!persisted) rmSync(pathFor(id), { force: true });
      throw error;
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
  return { pathFor, withExtract, verify, backup };
}
