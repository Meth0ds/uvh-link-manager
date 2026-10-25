import { randomUUID } from 'node:crypto';
import { hash, fail, RecoveryError } from './store.mjs';
import { publicOperation } from './operation-events.mjs';

/** Owns admission, idempotency, the exclusive lease and terminal persistence. */
export function createOperationOrchestrator({ enabled, data, validate, exclusive, now, save, execute, retain, maintenance }) {
  let task = null, pending = false;
  async function admit(action, target = {}, requestId, actor = { actor: 'system', emergency: false }) {
    validate(action, target);
    if (!enabled()) fail('disabled', 'El centro local está deshabilitado. Actívalo desde la herramienta local.');
    if (!/^[a-f0-9-]{36}$/.test(requestId ?? '')) fail('invalid_request', 'Identificador de petición no válido.', 400);
    const digest = hash(JSON.stringify(target));
    const replay = [data.operation, ...data.history].find(item => item?.requestId === requestId);
    if (replay) { if (replay.action !== action || (replay.targetDigest ?? hash(JSON.stringify(replay.target))) !== digest) fail('idempotency_conflict', 'La petición pertenece a otra orden.'); return publicOperation(replay); }
    if (action === 'cancel') {
      if (!data.operation || data.operation.id !== target.id || data.operation.action !== 'install' || !['queued', 'preflight', 'preparing'].includes(data.operation.phase) || data.maintenance) fail('cannot_cancel', 'La instalación ya entró en mantenimiento o no está activa.');
      data.operation.cancelRequested = true; save(); return structuredClone(data.operation);
    }
    if (task || pending) fail('operation_busy', 'Ya hay una operación activa.');
    if (data.operation?.state === 'requires_intervention' && !['restore', 'restore-selective', 'verify', 'check', 'reconcile', 'resume', 'destination', 'destination-test', 'policy'].includes(action)) fail('intervention_required', 'Resuelve la operación interrumpida antes de continuar.');
    pending = true;
    try {
      const lease = await exclusive.acquire(`recovery-${action}`, requestId);
      const operation = { id: randomUUID(), requestId, action, target: action === 'destination' ? Object.fromEntries(Object.entries(target).map(([field, value]) => ['accessKey', 'secretKey', 'password', 'factorCode'].includes(field) ? [field, '[redacted]'] : [field, value])) : target, targetDigest: digest, actor: actor.actor, emergency: actor.emergency, state: 'running', phase: 'queued', startedAt: now(), finishedAt: null, events: [], sequence: 0, error: null };
      if (data.operation) data.history = [...data.history, data.operation].slice(-100);
      data.operation = operation; save();
      task = (async () => {
        try { const result = await execute(action, target, actor); operation.state = result === 'restored' ? 'restored' : 'completed'; }
        catch (error) {
          operation.state = error.code === 'cancelled' ? 'cancelled' : data.maintenance ? 'requires_intervention' : 'failed';
          operation.error = { code: error instanceof RecoveryError ? error.code : 'operation_failed', message: error instanceof RecoveryError ? error.message : 'La operación no se completó. Revisa servicios, espacio y herramientas antes de reintentar.' };
          if (data.maintenance) data.reason = 'incident';
        } finally {
          operation.finishedAt = now();
          try {
            if (['completed', 'restored'].includes(operation.state)) retain();
          } catch {
            // Retention is housekeeping. It must never strand the operation
            // lock or claim success when catalog cleanup is inconsistent.
            operation.state = 'requires_intervention';
            operation.error = { code: 'retention_failed', message: 'La operación terminó, pero la retención requiere revisión local.' };
            data.maintenance = true;
            data.reason = 'incident';
          }
          try { save(); }
          finally {
            try { await exclusive.release(lease); }
            finally { task = null; }
          }
        }
      })();
      task.catch(() => { maintenance('incident'); });
      return publicOperation(operation);
    } finally { pending = false; }
  }
  return { admit, busy: () => Boolean(task || pending), idle: async () => { if (task) await task; } };
}
