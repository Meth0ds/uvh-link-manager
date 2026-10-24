import { createServer, request as httpRequest } from 'node:http';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { maintenancePage, adminPage, maintenanceScript, adminScript, css } from './pages.mjs';
import { fail, read, unwrap, envelope, atomic } from './store.mjs';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
const hop = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
function cleanHeaders(original) {
  const excluded = new Set([...hop, ...String(original.connection ?? '').toLowerCase().split(',').map(value => value.trim())]);
  return Object.fromEntries(Object.entries(original).filter(([key]) => !excluded.has(key.toLowerCase())));
}
async function body(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) fail('content_type', 'Se requiere JSON.', 415);
  let content = '', bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) fail('body_limit', 'Petición demasiado grande.', 413); content += chunk; }
  let value; try { value = JSON.parse(content); } catch { fail('invalid_json', 'JSON no válido.', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_body', 'Petición no válida.', 400);
  return value;
}
export async function serveRecoveryGateway({ engine, port = 4200, upstreamPort = 4201, font }) {
  const buffers = new Map([
    ['/__uvh/style.css', ['text/css; charset=utf-8', Buffer.from(css)]],
    ['/__uvh/maintenance.js', ['text/javascript; charset=utf-8', Buffer.from(maintenanceScript)]],
    ['/__uvh/admin.js', ['text/javascript; charset=utf-8', Buffer.from(adminScript)]],
  ]);
  if (font && existsSync(font)) buffers.set('/__uvh/manrope.woff2', ['font/woff2', readFileSync(font)]);
  const upgraded = new Set();
  const server = createServer(async (request, response) => {
    const send = (status, value, type = 'application/json; charset=utf-8', extra = {}) => {
      if (!response.writableEnded) { response.writeHead(status, { ...headers, 'Content-Type': type, ...extra }); response.end(type.startsWith('application/json') ? JSON.stringify(value) : value); }
    };
    try {
      const host = request.headers.host;
      if (![`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`].includes(host)) fail('invalid_host', 'Host local no autorizado.', 403);
      const origin = `http://${host}`;
      if (!request.url?.startsWith('/') || request.url.startsWith('//') || /[\\\r\n]/.test(request.url)) fail('invalid_url', 'Ruta no válida.', 400);
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/__uvh/')) {
        if (request.headers.origin && request.headers.origin !== origin) fail('invalid_origin', 'Origen no autorizado.', 403);
        if (['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) fail('invalid_origin', 'Contexto no autorizado.', 403);
        if (buffers.has(url.pathname) && request.method === 'GET') { const [type, value] = buffers.get(url.pathname); send(200, value, type); return; }
        if (url.pathname === '/__uvh/status' && request.method === 'GET') { send(200, engine.publicState()); return; }
        if (url.pathname === '/__uvh/maintenance' && request.method === 'GET') { send(engine.blocking() ? 503 : 200, maintenancePage, 'text/html; charset=utf-8', engine.blocking() ? { 'Retry-After': '30' } : {}); return; }
        if (url.pathname === '/__uvh/admin' && request.method === 'GET') { send(200, adminPage, 'text/html; charset=utf-8'); return; }
        if (!url.pathname.startsWith('/__uvh/api/')) fail('not_found', 'Ruta no encontrada.', 404);
        const action = url.pathname.slice('/__uvh/api/'.length), token = request.headers['x-uvh-recovery'];
        if (request.method === 'GET') {
          engine.auth.session(token);
          if (action === 'state') { send(200, engine.snapshot()); return; }
          if (action === 'events') { const cursor = Number(url.searchParams.get('cursor') ?? 0); if (!Number.isSafeInteger(cursor) || cursor < 0) fail('invalid_cursor', 'Cursor no válido.', 400); send(200, { events: engine.events(url.searchParams.get('id'), cursor) }); return; }
          fail('not_found', 'Ruta no encontrada.', 404);
        }
        if (request.method !== 'POST') fail('method', 'Método no permitido.', 405);
        if (request.headers.origin !== origin) fail('origin_required', 'Se requiere el origen de la página local.', 403);
        const input = await body(request);
        const fields = { login: ['code', 'ticket'], logout: [], enroll: [], revoke: [], confirm: ['action', 'target'], command: ['action', 'target', 'requestId', 'confirmationId'] }[action];
        if (!fields || Object.keys(input).some(key => !fields.includes(key))) fail('invalid_fields', 'Campos no admitidos.', 400);
        if (action === 'login') { send(200, engine.auth.login(input)); return; }
        const actor = engine.auth.session(token);
        if (action === 'logout') { engine.auth.logout(token); send(200, { ok: true }); return; }
        if (action === 'enroll') { send(200, { codes: engine.enrol(token) }); return; }
        if (action === 'revoke') { engine.auth.revoke(token); send(200, { ok: true }); return; }
        engine.validate(input.action, input.target);
        if (action === 'confirm') { send(200, { id: engine.auth.confirm(token, input.action, input.target) }); return; }
        if (action === 'command') {
          engine.auth.consume(token, input.action, input.target, input.confirmationId);
          send(202, { operation: await engine.admit(input.action, input.target, input.requestId, actor) }); return;
        }
        fail('not_found', 'Ruta no encontrada.', 404);
      }
      if (engine.blocking()) {
        if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) send(503, { error: 'La aplicación está en mantenimiento.', reason: 'local_maintenance' }, undefined, { 'Retry-After': '30' });
        else send(503, request.method === 'HEAD' ? '' : maintenancePage, 'text/html; charset=utf-8', { 'Retry-After': '30' });
        return;
      }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers: cleanHeaders(request.headers), timeout: 30000 }, result => {
        response.writeHead(result.statusCode, cleanHeaders(result.headers)); result.on('error', () => response.destroy()); result.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) send(503, maintenancePage, 'text/html; charset=utf-8', { 'Retry-After': '30' }); else response.destroy(); });
      request.on('aborted', () => upstream.destroy()); response.on('close', () => { if (!response.writableFinished) upstream.destroy(); }); request.pipe(upstream);
    } catch (error) { send(error.status ?? 500, { error: error.status ? error.message : 'No se pudo completar la operación.', code: error.status ? error.code : 'internal_error' }); }
  });
  server.on('upgrade', (request, socket, head) => {
    if (engine.blocking() || ![`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`].includes(request.headers.host)
        || request.headers.origin !== `http://${request.headers.host}`) { socket.destroy(); return; }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, headers: request.headers });
    upstream.on('upgrade', (result, stream, extra) => {
      upgraded.add(socket); upgraded.add(stream);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${result.rawHeaders.reduce((all, item, index, values) => index % 2 ? all : all + item + ': ' + values[index + 1] + '\r\n', '')}\r\n`);
      if (extra.length) socket.write(extra); if (head.length) stream.write(head); socket.pipe(stream).pipe(socket);
      for (const value of [socket, stream]) { value.on('error', () => { socket.destroy(); stream.destroy(); }); value.on('close', () => { upgraded.delete(value); socket.destroy(); stream.destroy(); }); }
    });
    upstream.on('error', () => socket.destroy()); upstream.on('response', result => { result.resume(); socket.destroy(); }); upstream.end();
  });
  server.headersTimeout = 10000; server.requestTimeout = 20000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, close: () => { for (const socket of upgraded) socket.destroy(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

/** Commands are authenticated by Laravel after a transactionally verified step-up. */
export async function drainBridge(engine) {
  const requests = join(engine.bridge, 'requests'), responses = join(engine.bridge, 'responses');
  if (!existsSync(requests)) return;
  for (const name of readdirSync(requests).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).slice(0, 10)) {
    const path = join(requests, name), destination = join(responses, name);
    try {
      const grant = unwrap(engine.bridgeKey, read(path));
      if (grant.id !== name.slice(0, -5) || grant.purpose !== 'recovery-command' || !Number.isSafeInteger(grant.expires) || grant.expires < Date.now() || grant.expires > Date.now() + 120000
          || !/^[0-9]+$/.test(String(grant.actor))) fail('expired_grant', 'La autorización local caducó.', 403);
      const operation = await engine.admit(grant.action, grant.target, grant.id, { actor: String(grant.actor), emergency: false });
      atomic(destination, envelope(engine.bridgeKey, { operation }));
    } catch (error) { atomic(destination, envelope(engine.bridgeKey, { error: error.status ? error.message : 'No se admitió la operación local.', code: error.code ?? 'bridge_error' })); }
    finally { unlinkSync(path); }
  }
}
