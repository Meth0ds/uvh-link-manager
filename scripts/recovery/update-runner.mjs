import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, RecoveryError } from './store.mjs';

export function createUpdateRunner({ home, io, data, event, save, backups, withExtract, backup, reopen, maintenance, validateCandidate, checked }) {
  async function restore(id, { automatic = false, emergencyWithoutBackup = false } = {}) {
    const entry = backups().find(value => value.id === id);
    if (!entry?.restoredAt) fail('backup_unverified', 'Selecciona una copia con restauración comprobada.');
    // Authenticate and test before taking down any healthy service.
    await withExtract(entry, folder => io.verify(folder));
    const expectedHead = await io.head(); await io.clean(); maintenance('recovery');
    await io.quiesce();
    if (!automatic) {
      try { const preventive = await backup('pre-restore'); data.operation.preventiveBackup = preventive.id; save(); }
      catch (error) { if (!emergencyWithoutBackup) throw new RecoveryError('preventive_backup_failed', 'No se pudo crear la copia preventiva. Usa la autorización de emergencia explícita solo si aceptas perder el estado actual.'); }
    }
    event('restoring', 'Restaurando la versión y sus datos. La aplicación permanece cerrada.');
    await withExtract(entry, async folder => { await io.restore(folder, expectedHead); });
    await reopen();
  }
  async function restoreSelective(id, paths, emergencyWithoutBackup = false) {
    const entry = backups().find(value => value.id === id);
    if (!entry?.restoredAt) fail('backup_unverified', 'Selecciona una copia con restauración comprobada.');
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100 || paths.some(path => typeof path !== 'string' || path.length > 240 || path.startsWith('/') || path.includes('..'))) fail('invalid_restore_paths', 'La selección de archivos no es válida.');
    await withExtract(entry, folder => io.verify(folder));
    await io.clean(); maintenance('recovery'); await io.quiesce();
    try { const preventive = await backup('pre-restore'); data.operation.preventiveBackup = preventive.id; save(); }
    catch (error) { if (!emergencyWithoutBackup) throw new RecoveryError('preventive_backup_failed', 'No se pudo crear la copia preventiva.'); }
    event('restoring', 'Restaurando únicamente los archivos privados seleccionados.');
    await withExtract(entry, folder => io.restoreSelective(folder, paths)); await reopen();
  }
  async function install(sha) {
    event('checking', 'Validando la versión, el checkout y las herramientas.');
    const plan = await validateCandidate(sha), stage = join(home, `stage-${randomUUID()}`);
    let applied = false, previous = null;
    try {
      event('preparing', 'Descargando y compilando el candidato en una copia aislada.'); await io.prepare(sha, stage);
      if (data.operation.cancelRequested) fail('cancelled', 'La instalación se canceló antes de modificar la aplicación.');
      await io.clean(); if (await io.head() !== plan.from) fail('checkout_changed', 'El checkout cambió durante la preparación.');
      // Refresh gates immediately before admitting the destructive phase.
      const gates = await checked(); if (gates.sha !== sha || !gates.eligible) fail('candidate_changed', 'GitHub cambió durante la preparación.');
      maintenance('update'); event('maintenance', 'Activando el modo de mantenimiento.'); event('quiescing', 'Deteniendo escrituras y procesos de trabajo.'); await io.quiesce();
      previous = await backup('pre-update'); data.operation.backupId = previous.id; data.operation.from = plan.from; data.operation.to = sha; save();
      event('applying', 'Aplicando código, dependencias y migraciones.'); applied = true;
      await io.apply(sha, plan.from); await reopen();
    } catch (error) {
      if (applied && previous) {
        data.operation.originalError = { code: error.code ?? 'installation_failed', message: 'La actualización falló. Se está recuperando la versión anterior.' }; save();
        // Exactly one automatic attempt, recorded before any restore side effect.
        event('restoring', 'La actualización falló. Recuperando la copia previa.');
        data.operation.recoveryAttempted = true; save();
        await restore(previous.id, { automatic: true });
        return 'restored';
      }
      throw error;
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  return { restore, restoreSelective, install };
}
