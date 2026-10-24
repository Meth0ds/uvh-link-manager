import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { secret } from './store.mjs';

const valid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value.trim()) ? value.trim() : null;

function command(file, args, options = {}) {
  try { return execFileSync(file, args, { encoding: 'utf8', timeout: options.timeout ?? 1200, input: options.input, stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function nativeStore({ platform, service, account }) {
  if (platform === 'darwin') {
    return {
      read: () => valid(command('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service, '-w'])),
      write: value => { command('/usr/bin/security', ['add-generic-password', '-U', '-a', account, '-s', service, '-w', value]); return valid(command('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service, '-w'])) === value; },
    };
  }
  if (platform === 'linux') {
    return {
      read: () => valid(command('secret-tool', ['lookup', 'service', service, 'account', account])),
      write: value => { return command('secret-tool', ['store', '--label', service, 'service', service, 'account', account], { input: value }) !== null; },
    };
  }
  return null;
}

/**
 * Prefer the OS credential store and keep a permission-checked fallback for
 * headless systems. The fallback is never part of a backup payload.
 */
export function createKeyProvider({ path, service = 'uvh-recovery', account = 'runtime', platform = process.platform } = {}) {
  const native = nativeStore({ platform, service, account });
  return {
    get() {
      const stored = native?.read();
      if (stored) return stored;
      if (native && !existsSync(path)) {
        const generated = randomBytes(32).toString('hex');
        if (native.write(generated)) return generated;
      }
      const fallback = secret(path);
      if (native?.write(fallback)) return fallback;
      return valid(fallback) ?? randomBytes(32).toString('hex');
    },
    backend: native ? platform : 'file',
  };
}
