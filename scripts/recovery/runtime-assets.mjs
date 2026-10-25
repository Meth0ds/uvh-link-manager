import { readFileSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Trace imports from the real entrypoint instead of shipping an entire folder. */
export function recoveryAssets(scriptsRoot) {
  const root = resolve(scriptsRoot), seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    const rel = relative(root, path);
    const metadata = lstatSync(path);
    if (rel.startsWith('..') || !metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Módulo runtime fuera del controlador.');
    seen.add(path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+\.mjs)['"]/g)) visit(resolve(dirname(path), match[1]));
  }
  visit(join(root, 'uvh-control.mjs'));
  const files = [...seen].map(path => relative(join(root, 'recovery'), path).replaceAll('\\', '/')).filter(path => !path.startsWith('..'));
  const pageRoot = join(root, 'recovery/page-assets');
  if (lstatSync(pageRoot).isSymbolicLink()) throw new Error('Recursos runtime enlazados fuera del controlador.');
  for (const name of ['style.css', 'maintenance.html', 'admin.html', 'maintenance.js', 'admin.js']) {
    const metadata = lstatSync(join(pageRoot, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Recurso runtime no válido.');
    files.push(`page-assets/${name}`);
  }
  return files.sort();
}
