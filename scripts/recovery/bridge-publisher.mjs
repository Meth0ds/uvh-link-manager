import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { atomic, envelope } from './store.mjs';

/** Only the full snapshot has an expiry; the minimal maintenance flag is stable. */
export function createBridgePublisher({ bridge, key, clock, snapshot, maintenance, revision }) {
  let lastFlag = null, projection = null, projectedRevision = -1;
  return () => {
    const current = revision();
    if (!projection || current !== projectedRevision) {
      projection = structuredClone(snapshot());
      projectedRevision = current;
    }
    atomic(join(bridge, 'snapshot.json'), envelope(key, { expires: clock() + 90000, ...projection }));
    const flag = maintenance(), body = JSON.stringify(flag), path = join(bridge, 'maintenance.json');
    if (body !== lastFlag || !existsSync(path)) {
      atomic(path, envelope(key, flag));
      lastFlag = body;
    }
  };
}
