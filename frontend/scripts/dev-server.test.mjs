import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {createDevelopmentServer, developmentRoute, preferredLanguage} from './dev-server.mjs';

const listening = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return new URL(`http://127.0.0.1:${server.address().port}`); };
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

test('root negotiation respects explicit preference, weighted regional languages and fallback', () => {
  assert.equal(preferredLanguage({'accept-language': 'fr,en-US;q=0.7,es-MX;q=0.9'}), 'es');
  assert.equal(preferredLanguage({cookie: 'other=1; uvh_language=en', 'accept-language': 'es'}), 'en');
  assert.equal(preferredLanguage({cookie: 'uvh_language=../../en', 'accept-language': 'de,en-GB;q=0'}), 'es');
  assert.equal(preferredLanguage({'accept-language': 'en;q=0.9,es;q=0.9'}), 'en');
  assert.deepEqual(developmentRoute('/?next=a%2Fb', {'accept-language': 'en-US'}), {status: 302, location: '/en/?next=a%2Fb'});
});

test('explicit locale wins and public route equivalents come from the shared manifest', () => {
  assert.deepEqual(developmentRoute('/es/app/links?favorite=1', {cookie: 'uvh_language=en'}), {target: 'es', path: '/es/app/links?favorite=1'});
  assert.deepEqual(developmentRoute('/en/legal/privacidad?q=%26'), {status: 308, location: '/en/legal/privacy?q=%26'});
  assert.deepEqual(developmentRoute('/es/help'), {status: 308, location: '/es/ayuda'});
  assert.deepEqual(developmentRoute('/en'), {status: 308, location: '/en/'});
  assert.deepEqual(developmentRoute('/en/'), {target: 'en', path: '/en/'});
});

test('legacy navigation preserves opaque queries and never localises short links or APIs', () => {
  assert.deepEqual(developmentRoute('/auth/verify-email?next=opaque%20value'), {status: 302, location: '/es/auth/verify-email?next=opaque%20value'});
  assert.deepEqual(developmentRoute('/help/'), {status: 308, location: '/es/ayuda'});
  for (const path of ['/api/v1/auth/language', '/r/es?qr=opaque', '/a/en', '/app-links/resolve', '/visitor-assets/game.js', '/.well-known/assetlinks.json', '/health', '/my-alias']) {
    assert.deepEqual(developmentRoute(path), {target: 'backend', path});
  }
  assert.deepEqual(developmentRoute('/legal/versions/old/terms.html'), {target: 'es', path: '/es/legal/versions/old/terms.html'});
  for (const path of ['https://attacker.example', '//attacker.example', '/\\attacker', '/x\r\ny']) assert.equal(developmentRoute(path).status, 400);
});

test('gateway serves both languages on one origin and preserves API method, body, cookies and origin', async () => {
  const servers = [];
  try {
    const targets = {};
    for (const name of ['es', 'en', 'backend']) {
      const server = http.createServer(async (request, response) => {
        let body = ''; for await (const chunk of request) body += chunk;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Set-Cookie', ['one=1; HttpOnly', 'two=2; SameSite=Lax']);
        response.end(JSON.stringify({name, path: request.url, method: request.method, body, origin: request.headers.origin, cookie: request.headers.cookie, host: request.headers.host}));
      });
      servers.push(server); targets[name] = await listening(server);
    }
    const gateway = createDevelopmentServer(targets); servers.push(gateway);
    const origin = await listening(gateway);
    const root = await fetch(origin, {redirect: 'manual', headers: {'Accept-Language': 'en-GB'}});
    assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/en/'); assert.equal(root.headers.get('cache-control'), 'no-store'); assert.equal(root.headers.get('vary'), 'Accept-Language, Cookie');
    for (const name of ['es', 'en']) assert.equal((await (await fetch(new URL(`/${name}/app/links`, origin))).json()).name, name);
    const response = await fetch(new URL('/api/v1/auth/language', origin), {method: 'PATCH', headers: {'Content-Type': 'application/json', Origin: origin.origin, Cookie: 'session=opaque'}, body: '{"language":"en"}'});
    assert.deepEqual(response.headers.getSetCookie(), ['one=1; HttpOnly', 'two=2; SameSite=Lax']);
    const data = await response.json();
    assert.deepEqual(data, {name: 'backend', path: '/api/v1/auth/language', method: 'PATCH', body: '{"language":"en"}', origin: origin.origin, cookie: 'session=opaque', host: origin.host});
  } finally { for (const server of servers.reverse()) await close(server); }
});

test('live reload upgrades are routed to the chosen locale and tunnel payloads', async () => {
  const upstream = http.createServer();
  let upstreamSocket;
  upstream.on('upgrade', (request, socket) => {
    upstreamSocket = socket;
    assert.equal(request.url, '/en/?token=opaque');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello');
    socket.on('data', data => socket.write(data));
  });
  const target = await listening(upstream);
  const gateway = createDevelopmentServer({es: target, en: target, backend: target});
  const origin = await listening(gateway);
  const socket = net.connect(Number(origin.port), '127.0.0.1');
  try {
    await once(socket, 'connect');
    socket.write('GET /en/?token=opaque HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    const [result] = await once(socket, 'data');
    assert.match(result.toString(), /^HTTP\/1.1 101/);
    assert.match(result.toString(), /hello$/);
    socket.write('updated');
    const [echo] = await once(socket, 'data'); assert.equal(echo.toString(), 'updated');
  } finally { socket.destroy(); upstreamSocket?.destroy(); await close(gateway); await close(upstream); }
});

test('unavailable upstream returns a clear failure instead of a false successful page', async () => {
  const gateway = createDevelopmentServer({es: new URL('http://127.0.0.1:1')});
  const origin = await listening(gateway);
  try { const response = await fetch(new URL('/es/', origin)); assert.equal(response.status, 502); assert.equal(response.headers.get('cache-control'), 'no-store'); }
  finally { await close(gateway); }
});
