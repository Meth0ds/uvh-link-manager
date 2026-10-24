import { existsSync, readdirSync, unlinkSync, rmSync, statfsSync } from 'node:fs';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, directory, atomic, read, secret, envelope, unwrap, fail, hash, RecoveryError } from './store.mjs';
import { createRecoveryAuth } from './auth.mjs';
import { createGithub } from './github.mjs';
import { sync as syncDestination } from './destinations.mjs';
import { createOperationEvents, publicOperation } from './operation-events.mjs';
import { planRetention } from './backup-catalog.mjs';
const now = () => new Date().toISOString();
const TERMINAL = new Set(['completed', 'restored', 'failed', 'cancelled', 'requires_intervention']);
const ACTIONS = new Set(['check', 'preflight', 'install', 'backup', 'verify', 'restore', 'restore-selective', 'resume', 'policy', 'destination', 'destination-test', 'delete', 'protect', 'reconcile', 'cancel']);
export function createRecoveryEngine({ root, home, io, exclusive, github = createGithub(), clock = Date.now, metadataKeyProvider = null }) {
  const store = createStore(home), bridge = directory(join(root, '.uvh-runtime/recovery-bridge'));
  const bridgeKey = secret(join(bridge, 'key')), key = metadataKeyProvider?.get() ?? secret(join(home, 'metadata-key'));
  const destinationStore = () => store.read('destinations', null);
  const destinations = () => destinationStore() ? unwrap(key, destinationStore()) : [];
  const saveDestinations = values => store.write('destinations', envelope(key, values));
  const auth = createRecoveryAuth(store, bridgeKey, clock);
  const defaults = { schema: 1, enabled: false, daily: true, dailyRetention: 7, weeklyRetention: 4, updateRetention: 3, backupDir: join(home, 'backups') };
  let config = { ...defaults, ...store.read('settings', defaults) };
  directory(config.backupDir);
  let data = store.read('state', { schema: 1, maintenance: false, reason: null, since: null, operation: null, history: [], github: null, diagnosis: null, lastDaily: null, lastWeekly: null });
  let task = null, pending = false, timer = null, polling = false, lastGithub = 0, lastProbe = 0, failures = 0, successes = 0;
  if (data.operation && !TERMINAL.has(data.operation.state)) {
    data.operation.state = 'requires_intervention'; data.operation.error = { code: 'interrupted', message: 'El controlador se interrumpió. Comprueba los procesos antes de restaurar.' };
    data.maintenance = true; data.reason = 'incident'; data.since ??= now(); store.write('state', data);
  }
  function save() { data.updatedAt = now(); store.write('state', data); publish(); }
  function backups() {
    const saved = store.read('backups', null);
    return saved ? unwrap(key, saved) : [];
  }
  function saveBackups(entries) { store.write('backups', envelope(key, entries)); }
  function publicState() {
    return { schema: 1, maintenance: data.maintenance, reason: data.reason, since: data.since, updatedAt: data.updatedAt ?? now(),
      phase: data.operation && !TERMINAL.has(data.operation.state) ? data.operation.phase : null, available: !data.maintenance };
  }
  function snapshot() {
    const entries = backups(), recommended = entries.filter(entry => entry.restoredAt && entry.sha === data.diagnosis?.sha).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { schema: 1, enabled: config.enabled, maintenance: publicState(), operation: publicOperation(data.operation), history: data.history.slice(-50).reverse().map(publicOperation),
      github: data.github, githubError: data.githubError ?? null, diagnosis: data.diagnosis, backups: entries.map(({ iv, tag, digest, ...entry }) => entry),
      recoveryConfigured: auth.configured(), policy: { daily: config.daily, dailyRetention: config.dailyRetention, weeklyRetention: config.weeklyRetention, updateRetention: config.updateRetention },
      destinations: destinations().map(({secretKey, accessKey, ...entry}) => ({ ...entry, configured: entry.type === 'folder' ? true : Boolean(accessKey && secretKey) })),
      recommendation: recommended ? { backupId: recommended.id, reason: 'Es la copia más reciente con restauración comprobada y el mismo commit que el checkout.' } : null,
      auditEvents: [...store.read('access', []), ...[data.operation, ...data.history].filter(item => item && TERMINAL.has(item.state)).map(item => ({ id: item.id, at: item.finishedAt ?? item.startedAt, action: `operation.${item.action}.${item.state}`, actor: item.actor }))].slice(-1000),
      updatedAt: data.updatedAt ?? now(), controllerProtocol: 1 };
  }
  function publish() {
    atomic(join(bridge, 'snapshot.json'), envelope(bridgeKey, { expires: clock() + 90000, ...snapshot() }));
    // Laravel's maintenance middleware reads only this signed, minimal flag.
    atomic(join(bridge, 'maintenance.json'), envelope(bridgeKey, { maintenance: data.maintenance, since: data.since }));
  }
  const events = createOperationEvents({ current: () => data.operation, persist: save, clock: now });
  const event = events.append;
  function maintenance(reason) { data.maintenance = true; data.reason = reason; data.since ??= now(); save(); }
  async function checked() {
    try { data.github = await github.check(await io.head()); lastGithub = clock(); data.githubError = null; save(); return data.github; }
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
  function pathFor(id) {
    if (!/^[a-f0-9-]{36}$/.test(id ?? '')) fail('invalid_backup', 'Identificador de copia no válido.', 400);
    return join(config.backupDir, `${id}.uvh.enc`);
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
      entry.integrityAt = now(); entry.restoredAt = now(); entry.error = null; saveBackups(entries); save();
    } catch (error) { entry.restoredAt = null; entry.error = 'La verificación no se completó. La copia no es apta para restauración automática.'; saveBackups(entries); save(); throw error; }
    return entry;
  }
  async function backup(tag) {
    await io.clean();
    const sha = await io.head(), id = randomUUID(), folder = directory(join(home, `backup-${id}`));
    let persisted = false;
    event('backing_up', 'Creando una copia cifrada de base, archivos, configuración y código.');
    try {
      const space = statfsSync(config.backupDir); if (space.bavail * space.bsize < 1024 ** 3) fail('disk_space', 'No hay espacio suficiente para una copia segura.');
      await io.backup(folder, sha);
      const crypt = await io.encrypt(folder, pathFor(id));
      const entry = { id, sha, tag, createdAt: now(), protected: false, integrityAt: null, restoredAt: null, ...crypt };
      saveBackups([...backups(), entry]); persisted = true; save();
      await verify(id);
      const verified = backups().find(value => value.id === id) ?? entry;
      const destinationValues = destinations(), external = destinationValues.filter(destination => destination.enabled !== false);
      verified.external = external.map(destination => ({ id: destination.id, status: 'pending' })); saveBackups([...backups().filter(value => value.id !== verified.id), verified]); save();
      for (const destination of external) {
        if (destination.retryAfter && Date.parse(destination.retryAfter) > Date.now()) {
          verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'circuit_open', retryAfter: destination.retryAfter } : item);
        } else {
          try {
            const result = await syncDestination(pathFor(id), destination, id, { statePath: join(home, 'multipart', `${destination.id}-${id}.json`) }); destination.failureCount = 0; destination.retryAfter = null; destination.status = 'ready';
            verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'completed', bytes: result.bytes, digest: result.digest, completedAt: now(), multipart: result.multipart === true } : item);
          } catch (error) {
            destination.failureCount = (destination.failureCount ?? 0) + 1; destination.status = 'failed';
            if (destination.failureCount >= 3) destination.retryAfter = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            verified.external = verified.external.map(item => item.id === destination.id ? { ...item, status: 'failed', error: error.code ?? 'destination_error', retryAfter: destination.retryAfter ?? null } : item);
          }
        }
        saveDestinations(destinationValues); saveBackups([...backups().filter(value => value.id !== verified.id), verified]); save();
      }
      return verified;
    } catch (error) {
      if (!persisted) rmSync(pathFor(id), { force: true });
      throw error;
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
  async function reopen() {
    event('validating', 'Comprobando esquema, servicios y frontend antes de abrir.');
    await io.start(); await io.health(); await io.reopen();
    data.maintenance = false; data.reason = null; data.since = null; failures = 0; successes = 0; save();
  }
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
      const entry = await backup(target.tag === 'daily' ? 'daily' : 'manual');
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
      try { await syncDestination(pathFor(latest.id), destination, latest.id, { statePath: join(home, 'multipart', `${destination.id}-${latest.id}.json`) }); destination.status = 'ready'; destination.lastTest = now(); destination.error = null; destination.failureCount = 0; destination.retryAfter = null; }
      catch (error) { destination.status = 'failed'; destination.error = error.code ?? 'destination_error'; destination.failureCount = (destination.failureCount ?? 0) + 1; if (destination.failureCount >= 3) destination.retryAfter = new Date(Date.now() + 15 * 60 * 1000).toISOString(); saveDestinations(values); throw error; }
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
  async function admit(action, target = {}, requestId, actor = { actor: 'system', emergency: false }) {
    validate(action, target);
    if (!config.enabled) fail('disabled', 'El centro local está deshabilitado. Actívalo desde la herramienta local.');
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
  function enable() { config.enabled = true; store.write('settings', config); save(); }
  async function tick() {
    if (polling) return; polling = true;
    try {
      publish();
      if (!config.enabled || task || pending) return;
      if (clock() - lastProbe >= 30000) {
        lastProbe = clock();
        try {
          const diagnosis = await io.diagnose(); data.diagnosis = diagnosis;
          if (diagnosis.healthy) { failures = 0; successes++; } else { successes = 0; failures++; }
          if (failures >= 3 && !data.maintenance) maintenance('incident');
          if (successes >= 3 && data.reason === 'incident' && (!data.operation || ['completed', 'restored', 'failed'].includes(data.operation.state))) { data.maintenance = false; data.reason = null; data.since = null; }
          const admins = await io.admins(); auth.reconcile(admins); save();
        } catch { successes = 0; if (++failures >= 3 && !data.maintenance) maintenance('incident'); }
      }
      if (clock() - lastGithub >= 900000) { lastGithub = clock(); try { await checked(); } catch { /* GitHub failure never takes the app down. */ } }
      if (config.daily && !data.maintenance && auth.configured() && data.diagnosis?.healthy && (!data.lastDaily || clock() - Date.parse(data.lastDaily) >= 86400000)) {
        // A failed daily backup must not run in a tight retry loop.
        data.lastDaily = now(); save(); try { await admit('backup', { tag: 'daily' }, randomUUID()); } catch { /* Another operation owns the shared lock. */ }
      }
      const weekday = new Date(clock()).getDay();
      if (config.daily && weekday === 1 && !data.maintenance && auth.configured() && data.diagnosis?.healthy && (!data.lastWeekly || clock() - Date.parse(data.lastWeekly) >= 6 * 86400000)) {
        data.lastWeekly = now(); save(); try { await admit('backup', { tag: 'weekly' }, randomUUID()); } catch { /* Daily or another operation owns the shared lock. */ }
      }
    } finally { polling = false; }
  }
  function start() { if (!timer) { timer = setInterval(() => { void tick().catch(() => {}); }, 10000); timer.unref(); } publish(); }
  function stop() { if (task) fail('operation_busy', 'Espera a que termine la recuperación.'); clearInterval(timer); timer = null; }
  return { auth, store, bridgeKey, bridge, snapshot, publicState, admit, validate, checked, enable, start, stop, tick,
    blocking: () => data.maintenance, idle: async () => { if (task) await task; }, configured: () => config.enabled,
    enrol: token => { const result = auth.enroll(token); save(); return result; },
    events: (id, cursor = 0) => events.since([data.operation, ...data.history].find(item => item?.id === id), cursor),
  };
}
