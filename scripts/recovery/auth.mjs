import { randomBytes, randomUUID } from 'node:crypto';
import { hash, equal, fail, unwrap } from './store.mjs';
export function createRecoveryAuth(store, bridgeKey, clock = Date.now) {
  const sessions = new Map(), confirmations = new Map();
  function state() { return store.read('credentials', { schema: 1, admins: {}, consumedTickets: [], attempts: { count: 0, until: 0 } }); }
  function audit(action, actor) {
    const events = store.read('access', []);
    store.write('access', [...events, { id: randomUUID(), at: new Date(clock()).toISOString(), action, actor }].slice(-1000));
  }
  function issue(actor, emergency) {
    const token = randomBytes(32).toString('hex');
    for (const [id, session] of sessions) if (session.expires < clock()) sessions.delete(id);
    if (sessions.size >= 64) fail('session_limit', 'Demasiadas sesiones de recuperación.', 429);
    sessions.set(token, { actor, emergency, expires: clock() + 10 * 60000 });
    audit(emergency ? 'emergency.login' : 'admin.login', actor);
    return { token, expiresIn: 600, emergency };
  }
  function login({ code, ticket }) {
    const data = state();
    if (data.attempts.until > clock()) fail('rate_limited', 'Demasiados intentos. Espera quince minutos.', 429);
    if (typeof ticket === 'string' && ticket.length < 8192) {
      let grant;
      try { grant = unwrap(bridgeKey, JSON.parse(Buffer.from(ticket, 'base64url').toString('utf8'))); } catch { /* Uniform authentication failure below. */ }
      if (grant?.purpose === 'recovery-access' && /^[0-9]+$/.test(String(grant.actor)) && /^[a-f0-9-]{36}$/.test(grant.id ?? '')
          && Number.isSafeInteger(grant.expires) && grant.expires >= clock() && grant.expires <= clock() + 60000
          && !data.consumedTickets.includes(grant.id)) {
        data.consumedTickets = [...data.consumedTickets, grant.id].slice(-1000);
        data.attempts = { count: 0, until: 0 }; store.write('credentials', data);
        return issue(String(grant.actor), false);
      }
    }
    if (typeof code === 'string' && /^[A-Fa-f0-9-]{40,70}$/.test(code)) {
      const value = hash(code.replaceAll('-', '').toLowerCase());
      for (const [actor, entry] of Object.entries(data.admins)) {
        const index = entry.codes.findIndex(saved => equal(saved, value));
        if (index < 0 || entry.revoked) continue;
        entry.codes.splice(index, 1); // Durable consumption precedes issuing a session.
        data.attempts = { count: 0, until: 0 }; store.write('credentials', data);
        return issue(actor, true);
      }
    }
    data.attempts.count++;
    if (data.attempts.count >= 5) data.attempts = { count: 0, until: clock() + 15 * 60000 };
    store.write('credentials', data); audit('login.failed', null);
    fail('authentication_failed', 'Credencial no válida o ya utilizada.', 403);
  }
  function session(token) {
    const value = sessions.get(token);
    if (!value || value.expires < clock() || (value.emergency && state().admins[value.actor]?.revoked)) fail('session_required', 'Inicia sesión de recuperación.', 401);
    return value;
  }
  function enroll(token) {
    const actor = session(token);
    if (actor.emergency) fail('normal_auth_required', 'Configura las credenciales desde Administración con MFA.', 403);
    const data = state();
    const codes = Array.from({ length: 8 }, () => randomBytes(24).toString('hex').match(/.{1,8}/g).join('-'));
    data.admins[actor.actor] = { codes: codes.map(code => hash(code.replaceAll('-', ''))), revoked: false };
    store.write('credentials', data); audit('credentials.enrolled', actor.actor);
    return codes;
  }
  function confirm(token, action, target) {
    session(token);
    for (const [id, value] of confirmations) if (value.expires < clock()) confirmations.delete(id);
    if (confirmations.size >= 64) fail('confirmation_limit', 'Demasiadas confirmaciones.', 429);
    const id = randomUUID(); confirmations.set(id, { token, action, target: JSON.stringify(target), expires: clock() + 60000 });
    return id;
  }
  function consume(token, action, target, id) {
    const actor = session(token), grant = confirmations.get(id); confirmations.delete(id);
    if (!grant || grant.token !== token || grant.action !== action || grant.target !== JSON.stringify(target) || grant.expires < clock()) fail('confirmation_required', 'Confirma de nuevo esta operación concreta.', 403);
    if (actor.emergency && !['backup', 'verify', 'restore', 'restore-selective', 'resume', 'reconcile'].includes(action)) fail('emergency_scope', 'El acceso de emergencia solo permite diagnóstico y recuperación.', 403);
    audit(`command.${action}`, actor.actor);
    return actor;
  }
  function reconcile(adminIds) {
    const data = state(), allowed = new Set(adminIds.map(String));
    let changed = false;
    for (const [id, entry] of Object.entries(data.admins)) if (!allowed.has(id) && !entry.revoked) { entry.revoked = true; changed = true; }
    if (changed) store.write('credentials', data);
    for (const [token, value] of sessions) if (!allowed.has(value.actor)) sessions.delete(token);
  }
  return { login, session, enroll, confirm, consume, reconcile, audit,
    configured: () => Object.values(state().admins).some(value => !value.revoked && value.codes.length),
    revoke: token => { const actor = session(token); const data = state(); if (data.admins[actor.actor]) data.admins[actor.actor].revoked = true; store.write('credentials', data); sessions.delete(token); audit('credentials.revoked', actor.actor); },
    logout: token => sessions.delete(token) };
}
