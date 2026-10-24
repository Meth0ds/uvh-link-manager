/**
 * Durable operation event handling.
 *
 * The recovery engine owns persistence and publication; this module owns the
 * event shape and sequencing so every operation uses the same ledger rules.
 */
export function createOperationEvents({ current, persist, clock = () => new Date().toISOString() }) {
  function append(phase, message, evidence = null) {
    const operation = current();
    if (!operation) return null;
    const sequence = (operation.sequence ?? 0) + 1;
    const event = { sequence, at: clock(), phase, message, ...(evidence ? { evidence } : {}) };
    operation.phase = phase;
    operation.events = [...(operation.events ?? []), event].slice(-200);
    operation.sequence = sequence;
    persist();
    return event;
  }

  function since(operation, cursor = 0) {
    if (!operation || !Number.isSafeInteger(cursor) || cursor < 0) return [];
    return (operation.events ?? []).filter(event => event.sequence > cursor);
  }

  return { append, since };
}

export function publicOperation(operation) {
  if (!operation) return null;
  const copy = structuredClone(operation);
  if (copy.target && typeof copy.target === 'object') {
    for (const field of ['accessKey', 'secretKey', 'password', 'factorCode']) {
      if (field in copy.target) copy.target[field] = '[redacted]';
    }
  }
  delete copy.targetDigest;
  return copy;
}
