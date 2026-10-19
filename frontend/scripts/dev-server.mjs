import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import routes from '../../shared/localisation/routes.json' with {type: 'json'};

const frontend = fileURLToPath(new URL('../', import.meta.url));
const manifestLanguages = Object.keys(routes.home);
// French compilers only start once its catalogue is authored; the switch keeps
// the existing Spanish/English development flow byte-for-byte identical.
const supported = process.env.UVH_FRENCH_ENABLED === 'true' ? manifestLanguages : manifestLanguages.filter(language => language !== 'fr');
const languagePrefix = languages => new RegExp(`^/(?:${languages.join('|')})(?=/|$)`);

export function preferredLanguage(headers, languages = supported) {
  const cookie = String(headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith('uvh_language='))?.slice(13);
  if (languages.includes(cookie)) return cookie;
  return String(headers['accept-language'] ?? '').slice(0, 4096).split(',').flatMap((part, order) => {
    const match = /^\s*([a-z]{2,3})(?:-[a-z0-9-]+)?\s*(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/i.exec(part);
    const quality = Number(match?.[2] ?? 1);
    const language = match?.[1]?.toLowerCase();
    return match && quality > 0 && languages.includes(language) ? [{language, quality, order}] : [];
  }).sort((a, b) => b.quality - a.quality || a.order - b.order)[0]?.language ?? 'es';
}

/** Only known UI addresses are localised. Short links and technical paths stay intact. */
export function developmentRoute(raw, headers = {}, languages = supported) {
  if (!raw?.startsWith('/') || raw.startsWith('//') || /[\r\n\\]/.test(raw)) return {status: 400};
  const url = new URL(raw, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/') return {status: 302, location: `/${preferredLanguage(headers, languages)}/${url.search}`};
  const prefixed = languagePrefix(languages).exec(pathname);
  if (prefixed) {
    const language = prefixed[0].slice(1);
    if (pathname === `/${language}`) return {status: 308, location: `/${language}/${url.search}`};
    const rest = pathname.slice(language.length + 1).replace(/\/$/, '') || '/';
    for (const translations of Object.values(routes)) {
      if (Object.values(translations).includes(rest) && translations[language] !== pathname.slice(language.length + 1)) {
        return {status: 308, location: `/${language}${translations[language]}${url.search}`};
      }
    }
    return {target: language, path: raw};
  }
  const legacy = {'/help': 'help', '/ayuda': 'help', '/aide': 'help', '/status': 'status', '/estado': 'status', '/statut': 'status', '/legal': 'terms'};
  const normalised = pathname.replace(/\/$/, '');
  const id = legacy[normalised] ?? Object.keys(routes).find(key => Object.values(routes[key]).includes(normalised));
  if (id) return {status: 308, location: `/es${routes[id].es}${url.search}`};
  if (/^\/(?:app|auth|reports|invitations|forbidden|not-found)(?:\/|$)/.test(pathname)) return {status: 302, location: `/es${raw}`};
  if (/^\/(?:api|r|a|app-links|visitor-assets|\.well-known|health)(?:\/|$)/.test(pathname)) return {target: 'backend', path: raw};
  if (/^\/legal\/versions\//.test(pathname) || /\.[a-z0-9]{1,8}$/i.test(pathname)) return {target: 'es', path: `/es${raw}`};
  return {target: 'backend', path: raw};
}

const hopHeaders = ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade'];
function proxyHeaders(headers, upgrade = false) {
  const result = {...headers};
  if (!upgrade) {
    for (const key of [...hopHeaders, ...String(headers.connection ?? '').toLowerCase().split(',').map(value => value.trim())]) delete result[key];
  }
  return result;
}

export function createDevelopmentServer(targets) {
  const server = http.createServer((request, response) => {
    let route;
    try { route = developmentRoute(request.url, request.headers); } catch { route = {status: 400}; }
    if (route.status) {
      response.writeHead(route.status, {'Cache-Control': 'no-store', Vary: 'Accept-Language, Cookie', ...(route.location ? {Location: route.location} : {})});
      response.end(); return;
    }
    const target = targets[route.target];
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      path: route.path, method: request.method, headers: proxyHeaders(request.headers),
    }, result => {
      response.writeHead(result.statusCode, proxyHeaders(result.headers));
      result.on('error', () => response.destroy());
      result.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
      response.end('UVH development server is starting or unavailable. Please retry.');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  });
  const connections = new Set();
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  // Node's default closeAllConnections deliberately excludes upgraded sockets.
  const closeHttpConnections = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    closeHttpConnections();
    for (const socket of connections) socket.destroy();
  };
  // Vite live reload stays on the public origin; no internal port is exposed in the UI.
  server.on('upgrade', (request, socket, head) => {
    let route;
    try { route = developmentRoute(request.url, request.headers); } catch { socket.destroy(); return; }
    if (!supported.includes(route.target)) { socket.destroy(); return; }
    const upstream = http.request(targets[route.target], {path: route.path, headers: proxyHeaders(request.headers, true)});
    upstream.on('upgrade', (result, stream, upstreamHead) => {
      const headers = result.rawHeaders.reduce((all, value, index, values) => index % 2 ? all : `${all}${value}: ${values[index + 1]}\r\n`, '');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) stream.write(head);
      socket.pipe(stream).pipe(socket);
      stream.on('error', () => socket.destroy());
      stream.on('close', () => socket.destroy());
      socket.on('error', () => stream.destroy());
      socket.on('close', () => stream.destroy());
    });
    upstream.on('response', result => { result.resume(); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  return server;
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
}

async function freePort() {
  const probe = http.createServer();
  await listen(probe, 0, '127.0.0.1');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

export async function startDevelopment(args = process.argv.slice(2)) {
  // Explicit specialist configurations keep the original CLI behaviour.
  const cli = path.join(frontend, 'node_modules/@angular/cli/bin/ng.js');
  if (args.some(value => /^--configuration(?:=|$)|^-c$/.test(value))) {
    const child = spawn(process.execPath, [cli, 'serve', ...args], {cwd: frontend, stdio: 'inherit'});
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.once('exit', code => { process.exitCode = code ?? 1; });
    return;
  }
  let host = '127.0.0.1', port = Number(process.env.PORT ?? 4200);
  for (let index = 0; index < args.length; index++) {
    const [key, inline] = args[index].split('=');
    if (!['--host', '--port'].includes(key)) throw new Error(`Unsupported option ${key}; use --host or --port, or npm run start:single for the Angular CLI.`);
    const value = inline ?? args[++index];
    if (key === '--host') host = value; else port = Number(value);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a loopback host and a valid development port.');
  const backend = new URL(process.env.BACKEND_URL ?? 'http://127.0.0.1:8000');
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('BACKEND_URL must be an HTTP(S) origin without credentials.');
  const targets = {backend};
  for (const language of supported) targets[language] = new URL(`http://127.0.0.1:${await freePort()}`);
  const server = createDevelopmentServer(targets);
  await listen(server, port, host);
  const children = [];
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    server.close(); server.closeAllConnections();
    for (const child of children) child.kill('SIGTERM');
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
  for (const language of supported) {
    const child = spawn(process.execPath, [cli, 'serve', '--build-target', `uvh:build:development,development-${language}`, '--host', '127.0.0.1', '--port', targets[language].port, '--serve-path', `/${language}`, '--prebundle=false'], {
      cwd: frontend, stdio: 'inherit', env: {...process.env, PORT: targets[language].port},
    });
    children.push(child);
    child.once('error', error => { console.error(error.message); stop(1); });
    child.once('exit', code => { if (!stopping) stop(code || 1); });
  }
  const labels = {es: 'Spanish /es/', en: 'British English /en/', fr: 'French /fr/'};
  const surfaces = supported.map(language => labels[language] ?? `/${language}`).join(', ');
  console.log(`UVH localised development: http://${host === '::1' ? '[::1]' : host}:${port}/ (${surfaces}). All compilers must finish before opening.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDevelopment().catch(error => { console.error(error.message); process.exitCode = 1; });
}
