import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomic, directory, fail, read, regular } from './store.mjs';

export const DEFAULT_PHP_IMAGE = 'uvh-php:8.4';
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const SERVICES = ['php', 'app', 'queue', 'queue-destinations', 'schedule'];
function exists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function validate(image) {
  if (image !== null && (typeof image !== 'string' || !IMAGE_ID.test(image))) {
    fail('invalid_image_selection', 'La imagen local debe ser un identificador inmutable verificado.');
  }
  return image;
}

/** Persistent controller state; never part of the restorable app payload. */
export function createImageSelection({ home, legacy = () => undefined }) {
  const statePath = join(home, 'selected-image.json');
  function selected() {
    if (exists(home)) directory(home);
    if (exists(statePath)) {
      regular(statePath, 4096);
      const value = read(statePath);
      if (!value || value.schema !== 1 || Object.keys(value).some(key => !['schema', 'image'].includes(key))) {
        fail('invalid_image_selection', 'La selección de imagen local requiere revisión.');
      }
      return validate(value.image);
    }
    const old = legacy();
    return old === undefined || old === '' || old === DEFAULT_PHP_IMAGE ? null : validate(old);
  }
  function select(image) {
    validate(image); directory(home); atomic(statePath, { schema: 1, image });
  }
  function files() {
    const image = selected();
    if (image === null) return [];
    const overridePath = join(home, `compose-image-${image.slice(7)}.json`);
    directory(home);
    const value = { services: Object.fromEntries(SERVICES.map(name => [name, { image, pull_policy: 'never' }])) };
    // Only our generated configuration reaches Docker, even if an old output
    // was modified. A symlink or special file is rejected before replacement.
    if (exists(overridePath)) regular(overridePath, 16384);
    if (!exists(overridePath) || readFileSync(overridePath, 'utf8') !== JSON.stringify(value)) atomic(overridePath, value);
    return ['-f', overridePath];
  }
  // Older checkouts still interpolate this name. Always pin their fallback
  // to the local build; a recovered image is supplied by the explicit file.
  const environment = (base = process.env) => ({ ...base, UVH_LOCAL_PHP_IMAGE: DEFAULT_PHP_IMAGE });
  return { selected, select, files, environment };
}
