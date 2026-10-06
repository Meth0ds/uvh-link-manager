import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createController } from '../../scripts/uvh-control.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'uvh-panel-browser-')));
for (const dir of ['backend-laravel/database/migrations', '.uvh-runtime']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, '.env.docker.local'), 'POSTGRES_DB=uvh_local\nPOSTGRES_USER=uvh_local\nPOSTGRES_PASSWORD=browser-fixture-secret\n');
writeFileSync(join(root, 'backend-laravel/database/migrations/001.php'), 'fixture');
writeFileSync(join(root, 'backend-laravel/database/migrations/002.php'), 'fixture');
writeFileSync(join(root, 'docker-compose.local.yml'), 'services: {}');
writeFileSync(join(root, '.uvh-runtime/frontend.out.log'), 'Angular ready\nhttp://127.0.0.1:4200\n');
const run = async (file, args, options) => {
  if (file !== 'docker') throw new Error(`External command forbidden in browser fixture: ${file}`);
  if (args[0] === 'info') return { code: 0, output: '28.4.0' };
  if (args.includes('ps')) return { code: 0, output: JSON.stringify(['postgres', 'app', 'queue', 'schedule'].map((Service) => ({ Service, State: 'running', Status: 'Up · proceso activo', Health: Service === 'postgres' ? 'healthy' : '' }))) };
  if (args.includes('psql')) return { code: 0, output: '001' };
  if (args.includes('logs')) return { code: 0, output: 'app       | GET /health 200\nqueue     | Waiting for jobs\nschedule  | No scheduled commands are ready\nPASSWORD=browser-fixture-secret\n' };
  await new Promise((yes, no) => { const timer = setTimeout(yes, 1500); options.signal?.addEventListener('abort', () => { clearTimeout(timer); no(options.signal.reason); }, { once: true }); });
  return { code: 0, output: 'Fixture: operación local simulada, ningún contenedor real.' };
};
const controller = createController({ root, panelDir: resolve('dist/panel/browser'), run, occupied: async () => true,
  probe: async (url) => ({ url, status: url.includes('8000') ? 'slow' : 'ok', httpStatus: 200, latencyMs: url.includes('8000') ? 3200 : 34 }) });
const { server, origin } = await controller.serve({ port: Number(process.env.UVH_PANEL_PREVIEW_PORT ?? 4597), open: false });
console.log(`Fixture privada de UVH Control: ${origin} · PID ${process.pid}`);
function stop() { server.closeAllConnections(); server.close(() => { rmSync(root, { recursive: true, force: true }); }); }
process.once('SIGTERM', stop); process.once('SIGINT', stop);
