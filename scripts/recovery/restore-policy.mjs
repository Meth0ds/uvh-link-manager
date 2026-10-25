import { fail } from './store.mjs';

export const MAX_SELECTIVE_PATHS = 100;
export const MAX_SELECTIVE_PATH_LENGTH = 240;

export function validateSelectivePaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_SELECTIVE_PATHS
      || paths.some(path => typeof path !== 'string' || path.length === 0 || path.length > MAX_SELECTIVE_PATH_LENGTH
        || path.startsWith('/') || path.includes('..') || /[\\\x00-\x1f]/.test(path))) {
    fail('invalid_restore_paths', 'La selección de archivos no es válida.', 400);
  }
  return paths;
}
