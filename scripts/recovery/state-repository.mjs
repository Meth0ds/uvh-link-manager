import { envelope, unwrap } from './store.mjs';
import { backupCategory } from './backup-catalog.mjs';

/** Signed documents retain their existing on-disk representation. */
export function createRecoveryRepository(store, key, operations) {
  const readSigned = name => {
    const saved = store.read(name, null);
    return saved ? unwrap(key, saved) : [];
  };
  const readBackups = () => readSigned('backups');
  return {
    readBackups,
    backups: () => {
      const evidence = operations();
      // unwrap parses a fresh document; enrich that owned read instead of
      // cloning every entry before the public projection clones it again.
      const entries = readBackups();
      for (const entry of entries) entry.category = backupCategory(entry, evidence);
      return entries;
    },
    saveBackups: entries => store.write('backups', envelope(key, entries)),
    destinations: () => readSigned('destinations'),
    saveDestinations: entries => store.write('destinations', envelope(key, entries)),
  };
}
