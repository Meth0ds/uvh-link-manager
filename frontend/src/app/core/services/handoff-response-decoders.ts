import type { HandoffState, ParkReceipt, ParkedHandoffs } from "./pending-handoff.service";
import { boolean, invalid, record } from "./response-decoder-helpers";

const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/**
 * The longest a handoff may stay parked is the invitation's seven days. The
 * intent's own ceiling is 24 hours, which is stricter; this bound is the outer
 * envelope both must fit inside, so a response cannot extend a browser's hold
 * on a bearer past what the server would ever grant.
 */
const MAX_HANDOFF_TTL_MS = 7 * 24 * 60 * 60_000;

function expiry(value: unknown, contract: string): string {
  if (typeof value !== "string" || value.length > 64 || !EXPIRY_PATTERN.test(value)) {
    invalid(contract);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)
    || parsed <= Date.now() - MAX_CLOCK_SKEW_MS
    || parsed > Date.now() + MAX_HANDOFF_TTL_MS + MAX_CLOCK_SKEW_MS) {
    invalid(contract);
  }
  return value;
}

/**
 * A parked handoff: either it is held and has a deadline, or it is not held and
 * has none. The two halves cannot be reported separately — a deadline without a
 * park would put a countdown in front of a flow that cannot run, and a park
 * without a deadline would let the panel offer a credential whose expiry it
 * cannot know.
 */
function parkedState(value: unknown, contract: string): HandoffState {
  const source = record(value, contract);
  const pending = boolean(source["pending"], contract);
  if (source["expiresAt"] === null || source["expiresAt"] === undefined) {
    if (pending) invalid(contract);
    return { pending: false, expiresAt: null };
  }
  const expiresAt = expiry(source["expiresAt"], contract);
  if (!pending) invalid(contract);
  return { pending: true, expiresAt };
}

/** `POST /api/v1/pending/{kind}`: the server holds this bearer from now on. */
export function decodeParkReceipt(value: unknown): ParkReceipt {
  const source = record(value, "park receipt");
  if (source["pending"] !== true) invalid("park receipt");
  return { pending: true, expiresAt: expiry(source["expiresAt"], "park receipt") };
}

/** `GET /api/v1/pending`: which of the two handoffs this browser is holding. */
export function decodeParkedHandoffs(value: unknown): ParkedHandoffs {
  const source = record(value, "parked handoffs");
  return {
    invitation: parkedState(source["invitation"], "parked handoffs"),
    "link-intent": parkedState(source["linkIntent"], "parked handoffs"),
  };
}
