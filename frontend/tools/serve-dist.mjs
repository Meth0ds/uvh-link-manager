// Servidor de desarrollo local para la SPA compilada (dist/uvh/browser).
//
// ¿Por qué no basta con `ng serve`? El código fuente de src/ no está presente
// en este checkout, solo el build de producción. Este script sirve ese build
// y hace proxy de las rutas de API hacia Laravel (php artisan serve en el
// contenedor `app`, puerto 8000), de modo que la SPA y la API comparten
// origen y las cookies de sesión (uvh_session) funcionan sin CORS.
//
// Uso:   node tools/serve-dist.mjs [puerto] [destino-proxy]
//        node tools/serve-dist.mjs 4200 http://127.0.0.1:8000

import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const PORT = Number(argv[0]) || 4200;
const API_TARGET = argv[1] || 'http://127.0.0.1:8000';
const API_PREFIX = '/api/';
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist/uvh/browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function fileIfExists(path) {
  try {
    const stats = await stat(path);
    return stats.isFile() ? path : null;
  } catch {
    return null;
  }
}

function proxy(req, res) {
  const target = new URL(req.url, API_TARGET);
  const headers = { ...req.headers, host: target.host };
  delete headers.origin; // same-origin tras el proxy: no filtrar CORS al backend
  const upstream = httpRequest(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API no disponible', detail: String(error) }));
  });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  // La API (y sus cookies CSRF) se delega al backend de Laravel.
  if (urlPath.startsWith(API_PREFIX)) {
    proxy(req, res);
    return;
  }

  const safePath = normalize(urlPath).replace(/^([/\\]|\.\.)+/, '');
  let filePath = await fileIfExists(join(DIST, safePath));

  if (!filePath && !extname(safePath)) {
    // SPA fallback: rutas sin extensión sirven index.html.
    filePath = await fileIfExists(join(DIST, 'index.html'));
  }

  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`UVH SPA (dist) en http://127.0.0.1:${PORT} -> API ${API_TARGET}`);
});
