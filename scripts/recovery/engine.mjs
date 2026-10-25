import { existsSync, unlinkSync } from 'node:fs';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, directory, secret, fail } from './store.mjs';
import { createRecoveryAuth } from './auth.mjs';
import { createGithub } from './github.mjs';
import { sync as syncDestination } from './destinations.mjs';
import { createOperationEvents, publicOperation } from './operation-events.mjs';
import { createOperationOrchestrator } from './operation-orchestrator.mjs';
import { createBackupRunner } from './backup-runner.mjs';
import { createUpdateRunner } from './update-runner.mjs';
import { createHealthMonitor } from './health-monitor.mjs';
import { planRetention, backupCategory } from './backup-catalog.mjs';
import { createRecoveryRepository } from './state-repository.mjs';
import { createBridgePublisher } from './bridge-publisher.mjs';
const TERMINAL = new Set(['completed', 'restored', 'failed', 'cancelled', 'requires_intervention']);
const ACTIONS = new Set(['check', 'preflight', 'install', 'backup', 'verify', 'restore', 'restore-selective', 'resume', 'policy', 'destination', 'destination-test', 'delete', 'protect', 'reconcile', 'cancel']);
export function createRecoveryEngine({ root, home, io, exclusive, github = createGithub(), clock = Date.now, metadataKeyProvider = null }) {
  const now = () => new Date(clock()).toISOString();
  const store = createStore(home), bridge = directory(join(root, '.uvh-runtime/recovery-bridge'));
  const bridgeKey = secret(join(bridge, 'key')), key = metadataKeyProvider?.get() ?? secret(join(home, 'metadata-key'));
  const auth = createRecoveryAuth(store, bridgeKey, clock);
  const defaults = { schema: 1, enabled: false, daily: true, dailyRetention: 7, weeklyRetention: 4, updateRetention: 3, backupDir: join(home, 'backups') };
  let config = { ...defaults, ...store.read('settings', defaults) };
  directory(config.backupDir);
  let data = store.read('state', { schema: 1, maintenance: false, reason: null, since: null, operation: null, history: [], github: null, diagnosis: null, lastDaily: null, lastWeekly: null });
  let timer = null;
  if (data.operation && !TERMINAL.has(data.operation.state)) {
    data.operation.state = 'requires_intervention'; data.operation.error = { code: 'interrupted', message: 'El controlador se interrumpió. Comprueba los procesos antes de restaurar.' };
    data.maintenance = true; data.reason = 'incident'; data.since ??= now(); store.write('state', data);
  }
  function save() { data.updatedAt = now(); store.write('state', data); publish(); }
  const { readBackups, backups, saveBackups, destinations, saveDestinations } = createRecoveryRepository(store, key, () => [data.operation, ...data.history]);
  function publicState() {
    return { schema: 1, maintenance: data.maintenance, reason: data.reason, since: data.since, updatedAt: data.updatedAt ?? now(),
      phase: data.operation && !TERMINAL.has(data.operation.state) ? data.operation.phase : null, available: !data.maintenance };
  }
  function snapshot() {
    const evidence = [data.operation, ...data.history], diagnosisSha = data.diagnosis?.sha;
    let recommended = null;
    // Classify, select recovery and project the owned catalogue in one pass.
    const publicBackups = readBackups().map(entry => {
      if (entry.restoredAt && entry.sha === diagnosisSha && (!recommended || entry.createdAt > recommended.createdAt)) recommended = entry;
      const { iv, tag, digest, category, ...publicEntry } = entry;
      return { ...publicEntry, tag: backupCategory(entry, evidence) };
    });
    return { schema: 1, enabled: config.enabled, maintenance: publicState(), operation: publicOperation(data.operation), history: data.history.slice(-50).reverse().map(publicOperation),
      github: data.github, githubError: data.githubError ?? null, diagnosis: data.diagnosis, backups: publicBackups,
      recoveryConfigured: auth.configured(), policy: { daily: config.daily, dailyRetention: config.dailyRetention, weeklyRetention: config.weeklyRetention, updateRetention: config.updateRetention },
      destinations: destinations().map(({secretKey, accessKey, ...entry}) => ({ ...entry, configured: entry.type === 'folder' ? true : Boolean(accessKey && secretKey) })),
      recommendation: recommended ? { backupId: recommended.id, reason: 'Es la copia más reciente con restauración comprobada y el mismo commit que el checkout.' } : null,
      auditEvents: [...store.read('access', []), ...[data.operation, ...data.history].filter(item => item && TERMINAL.has(item.state)).map(item => ({ id: item.id, at: item.finishedAt ?? item.startedAt, action: `operation.${item.action}.${item.state}`, actor: item.actor }))].slice(-1000),
      updatedAt: data.updatedAt ?? now(), controllerProtocol: 1 };
  }
  const publish = createBridgePublisher({ bridge, key: bridgeKey, clock, snapshot, revision: () => store.revision,
    maintenance: () => ({ maintenance: data.maintenance, since: data.since }) });
  const events = createOperationEvents({ current: () => data.operation, persist: save, clock: now });
  const event = events.append;
  function maintenance(reason) { data.maintenance = true; data.reason = reason; data.since ??= now(); save(); }
  async function checked() {
    try { data.github = await github.check(await io.head()); monitor.checked(); data.githubError = null; save(); return data.github; }
    catch (error) { if (data.github) data.github.stale = true; data.githubError = { code: error.code ?? 'version_source_unavailable', message: 'No se pudo consultar el servicio de versiones. Revisa la conexión y las credenciales configuradas.' }; save(); throw error; }
  }
  async function validateCandidate(sha) {
    if (data.maintenance) fail('maintenance_active', 'Resuelve el mantenimiento actual antes de actualizar.');
    if (!auth.configured()) fail('emergency_not_configured', 'Configura primero los códigos de emergencia.');
    const current = await checked();
    if (current.sha !== sha || !current.eligible || current.stale || current.from === sha) fail('candidate_blocked', 'El candidato cambió o no tiene todas las comprobaciones aprobadas.');
    if (!backups().some(entry => entry.restoredAt)) fail('restore_drill_required', 'Crea y verifica una copia antes de instalar actualizaciones.');
    return io.preflight(sha);
  }
  const { pathFor, withExtract, verify, backup } = createBackupRunner({ home, io, getConfig: () => config, data, now, clock, event, save, publish, backups, saveBackups, destinations, saveDestinations });
  async function reopen() {
    event('validating', 'Comprobando esquema, servicios y frontend antes de abrir.');
    await io.start(); await io.health(); await io.reopen();
    data.maintenance = false; data.reason = null; data.since = null; monitor.reset(); save();
  }
  const { restore, restoreSelective, install } = createUpdateRunner({ home, io, data, event, save, backups, withExtract, backup, reopen, maintenance, validateCandidate, checked });
  function retain() {
    const protectedIds = new Set([data.operation?.backupId, data.operation?.preventiveBackup]);
    for (const op of data.history) if (op.state === 'requires_intervention') { protectedIds.add(op.backupId); protectedIds.add(op.preventiveBackup); }
    const plan = planRetention(backups(), { dailyRetention: config.dailyRetention, weeklyRetention: config.weeklyRetention, updateRetention: config.updateRetention, protectedIds });
    for (const entry of plan.remove) if (existsSync(pathFor(entry.id))) unlinkSync(pathFor(entry.id));
    saveBackups(plan.keep);
  }
  async function execute(action, target, actor) {
    if (action === 'check') { await checked(); return; }
    if (action === 'preflight') { data.preflight = await validateCandidate(target.sha); data.operation.plan = data.preflight; save(); return; }
    if (action === 'install') return install(target.sha);
    if (action === 'verify') { await verify(target.id); return; }
    if (action === 'restore') return restore(target.id, { emergencyWithoutBackup: actor.emergency && target.withoutPreventive === true });
    if (action === 'restore-selective') return restoreSelective(target.id, target.paths, actor.emergency && target.withoutPreventive === true);
    if (action === 'resume') { await reopen(); return; }
    if (action === 'reconcile') { await io.health(); event('reconciled', 'Los servicios se han comprobado; el mantenimiento se conserva hasta reabrir explícitamente.'); return; }
    if (action === 'backup') {
      await io.clean();
      const already = data.maintenance; maintenance('backup'); await io.quiesce();
      const entry = await backup(['daily', 'weekly'].includes(target.tag) ? target.tag : 'manual');
      data.operation.backupId = entry.id; if (target.tag === 'daily') data.lastDaily = now();
      if (!already) await reopen(); return;
    }
    if (action === 'destination') {
      const existing = destinations();
      if (!['folder', 's3'].includes(target.type) || typeof target.name !== 'string' || target.name.length < 1 || target.name.length > 80) fail('invalid_destination', 'Destino externo no válido.', 400);
      if (target.type === 'folder' && (!isAbsolute(target.path) || !relative(root, resolve(target.path)).startsWith('..'))) fail('invalid_destination', 'La carpeta externa debe estar fuera del checkout.', 400);
      const prefix = target.prefix ?? '';
      const unsafePrefix = typeof prefix !== 'string' || prefix.length > 256 || prefix.includes('..') || [...prefix].some(character => character.charCodeAt(0) < 32 || '<>:"\\'.includes(character));
      if (target.type === 's3' && (!/^https:\/\//.test(target.endpoint ?? '') || !target.bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(target.bucket) || !/^[a-z0-9-]{1,32}$/.test(target.region) || typeof target.accessKey !== 'string' || target.accessKey.length > 256 || typeof target.secretKey !== 'string' || target.secretKey.length > 512 || unsafePrefix)) fail('destination_credentials', 'Completa un destino HTTPS válido, bucket, región y credenciales.', 422);
      const id = target.id && /^[a-f0-9-]{36}$/.test(target.id) ? target.id : randomUUID();
      const value = { id, name: target.name, type: target.type, enabled: target.enabled !== false, ...(target.type === 'folder' ? { path: resolve(target.path) } : { endpoint: target.endpoint, bucket: target.bucket, region: target.region, prefix: target.prefix ?? '', accessKey: target.accessKey, secretKey: target.secretKey }) };
      saveDestinations([...existing.filter(item => item.id !== id), value]); return;
    }
    if (action === 'destination-test') {
      const values = destinations(), destination = values.find(item => item.id === target.id);
      if (!destination) fail('destination_missing', 'Destino no encontrado.', 404);
      const latest = backups().find(item => item.restoredAt);
      if (!latest) fail('restore_drill_required', 'Necesitas una copia verificada antes de probar el destino.', 409);
      try { await syncDestination(pathFor(latest.id), destination, latest.id, { statePath: join(home, 'multipart', `${destination.id}-${latest.id}.json`), digest: latest.digest, clock }); destination.status = 'ready'; destination.lastTest = now(); destination.error = null; destination.failureCount = 0; destination.retryAfter = null; }
      catch (error) { destination.status = 'failed'; destination.error = error.code ?? 'destination_error'; destination.failureCount = (destination.failureCount ?? 0) + 1; if (destination.failureCount >= 3) destination.retryAfter = new Date(clock() + 15 * 60 * 1000).toISOString(); saveDestinations(values); throw error; }
      saveDestinations(values); return;
    }
    if (action === 'policy') {
      if (typeof target.daily !== 'boolean' || !Number.isSafeInteger(target.dailyRetention) || target.dailyRetention < 1 || target.dailyRetention > 90
          || !Number.isSafeInteger(target.weeklyRetention) || target.weeklyRetention < 1 || target.weeklyRetention > 52
          || !Number.isSafeInteger(target.updateRetention) || target.updateRetention < 1 || target.updateRetention > 30) fail('invalid_policy', 'Política de copias no válida.', 400);
      if (target.backupDir !== undefined) {
        if (!isAbsolute(target.backupDir)) fail('invalid_destination', 'El destino debe ser una ruta absoluta.', 400);
        const path = resolve(target.backupDir), rel = relative(root, path);
        if (!rel.startsWith('..') || relative(path, root) === '' || !relative(path, root).startsWith('..')) fail('invalid_destination', 'El destino externo no puede contener el checkout ni estar dentro de él.');
        if (backups().length) fail('destination_in_use', 'Conserva el destino mientras existan copias; migra el archivo desde la herramienta local.');
        directory(path); config.backupDir = path;
      }
      config = { ...config, daily: target.daily, dailyRetention: target.dailyRetention, weeklyRetention: target.weeklyRetention, updateRetention: target.updateRetention };
      store.write('settings', config); return;
    }
    if (action === 'protect' || action === 'delete') {
      const entries = backups(), entry = entries.find(value => value.id === target.id);
      if (!entry) fail('backup_missing', 'Copia no encontrada.', 404);
      if (action === 'protect') { entry.protected = target.protected === true; saveBackups(entries); return; }
      if (entry.protected || data.operation.backupId === entry.id || entries.filter(value => value.restoredAt).length <= 1 || data.history.some(item => item.state === 'requires_intervention' && [item.backupId, item.preventiveBackup].includes(entry.id))) fail('backup_protected', 'Esta copia está protegida o es necesaria para recuperar el entorno.');
      unlinkSync(pathFor(entry.id)); saveBackups(entries.filter(value => value.id !== entry.id)); return;
    }
  }
  function validate(action, target) {
    if (!ACTIONS.has(action) || !target || typeof target !== 'object' || Array.isArray(target)) fail('invalid_command', 'Orden no válida.', 400);
    const keys = { check: [], preflight: ['sha'], install: ['sha'], backup: ['tag'], verify: ['id'], restore: ['id', 'withoutPreventive'], 'restore-selective': ['id', 'paths', 'withoutPreventive'], resume: [], reconcile: [], cancel: ['id'], policy: ['daily', 'dailyRetention', 'weeklyRetention', 'updateRetention', 'backupDir'], destination: ['id', 'name', 'type', 'path', 'endpoint', 'bucket', 'region', 'prefix', 'accessKey', 'secretKey', 'enabled'], 'destination-test': ['id'], delete: ['id'], protect: ['id', 'protected'] }[action];
    if (Object.keys(target).some(key => !keys.includes(key))) fail('invalid_command', 'Campos de orden no admitidos.', 400);
    if (['preflight', 'install'].includes(action) && !/^[a-f0-9]{40}$/.test(target.sha ?? '')) fail('invalid_sha', 'Commit no válido.', 400);
    if (['verify', 'restore', 'restore-selective', 'delete', 'protect'].includes(action)) pathFor(target.id);
  }
  const orchestrator = createOperationOrchestrator({ enabled: () => config.enabled, data, validate, exclusive, now, save, execute, retain, maintenance });
  const admit = orchestrator.admit;
  function enable() { config.enabled = true; store.write('settings', config); save(); }
  const monitor = createHealthMonitor({ clock, now, publish, enabled: () => config.enabled, isBusy: orchestrator.busy, data, io, auth, save, maintenance, checked, configured: () => config, admit });
  const tick = monitor.tick;
  function start() { if (!timer) { timer = setInterval(() => { void tick().catch(() => {}); }, 10000); timer.unref(); } publish(); }
  function stop() { if (orchestrator.busy()) fail('operation_busy', 'Espera a que termine la recuperación.'); clearInterval(timer); timer = null; }
  return { auth, store, bridgeKey, bridge, snapshot, publicState, admit, validate, checked, enable, start, stop, tick,
    blocking: () => data.maintenance, idle: orchestrator.idle, configured: () => config.enabled,
    enrol: token => { const result = auth.enroll(token); save(); return result; },
    events: (id, cursor = 0) => events.since([data.operation, ...data.history].find(item => item?.id === id), cursor),
  };
}
