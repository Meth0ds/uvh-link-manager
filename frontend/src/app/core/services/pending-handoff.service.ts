import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { decodeParkReceipt, decodeParkedHandoffs } from "./handoff-response-decoders";

/** The two handoffs the panel can park, matching the server's `{kind}` segment. */
export type HandoffKind = "invitation" | "link-intent";

export interface HandoffState {
  pending: boolean;
  expiresAt: string | null;
}

export type ParkedHandoffs = Record<HandoffKind, HandoffState>;

export interface ParkReceipt {
  pending: true;
  expiresAt: string;
}

const NOT_PARKED: HandoffState = { pending: false, expiresAt: null };

/** Same shape the server accepts: 32 random bytes in unpadded base64url. */
const BEARER_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Client of the server-side handoff park (`/api/v1/pending`).
 *
 * An invitation bearer lives seven days and a prepared-link bearer one, which
 * is long enough that keeping them in `localStorage` handed any script on the
 * origin a working credential. The panel now gives the bearer to the server
 * once, gets an HttpOnly cookie back, and from then on only asks whether a
 * handoff is parked. Nothing in this class can read a bearer, and no method
 * here stores one.
 *
 * Two consequences shape the interface:
 *
 *  - **Parking is optimistic, confirmation is explicit.** `park()` flips the
 *    local state and returns synchronously, because the panel's own navigation
 *    depends on it (`capture()` deciding which tab opens, or which return target
 *    a login uses). Anything that is about to *spend* the bearer — claiming a
 *    link intent, accepting an invitation — must await `confirmed(kind)`, which
 *    resolves once the server has actually taken it.
 *  - **A failed park is reverted, not hidden.** If the request fails the local
 *    state goes back to "not parked", so the panel never offers a flow whose
 *    credential the browser does not hold.
 *
 * `hide()` and `forget()` look similar and are not: `hide()` forgets the
 * handoff *locally*, for the cases where the server has already dropped it as
 * part of its own terminal answer, while `forget()` asks the server to drop it
 * (and the cookie with it) because the browser must stop holding a live one.
 */
@Injectable({ providedIn: "root" })
export class PendingHandoffService {
  private readonly api = inject(ApiService);
  private readonly states = signal<ParkedHandoffs>({
    invitation: NOT_PARKED,
    "link-intent": NOT_PARKED,
  });
  private readonly revisions = signal<Record<HandoffKind, number>>({ invitation: 0, "link-intent": 0 });
  private readonly outcomes = signal<Record<HandoffKind, boolean | null>>({ invitation: null, "link-intent": null });
  private readonly parking = new Map<HandoffKind, Promise<boolean>>();
  private refreshing: Promise<void> | null = null;

  readonly invitation = computed(() => this.states().invitation);
  readonly linkIntent = computed(() => this.states()["link-intent"]);
  /** Latest park outcome per kind, `null` until one has been attempted here. */
  readonly invitationOutcome = computed(() => this.outcomes().invitation);
  readonly intentOutcome = computed(() => this.outcomes()["link-intent"]);

  state(kind: HandoffKind): HandoffState {
    return this.states()[kind];
  }

  parked(kind: HandoffKind): boolean {
    return this.states()[kind].pending;
  }

  expiresAt(kind: HandoffKind): string | null {
    return this.states()[kind].expiresAt;
  }

  /**
   * An opaque identity of the parked handoff, for request-ordering checks.
   *
   * It is deliberately not the bearer: it changes every time the parked handoff
   * changes and carries no secret. A component that captured revision N can
   * still tell "the same handoff I started with" from "another one" after an
   * await, which is what the callers used the bearer for.
   */
  revision(kind: HandoffKind): number {
    return this.revisions()[kind];
  }

  /**
   * Hand a bearer to the server.
   *
   * Returns false without contacting anything when the value is not the shape
   * this application issues, or when the deadline the caller declares has
   * already passed — parking an expired credential only moves the failure to
   * the next visit. An absent deadline is not a failure: the server applies its
   * own ceiling, which is what the caller is asking for.
   */
  park(kind: HandoffKind, bearer: string, expiresAt?: string | null): boolean {
    const declared = this.declaredExpiry(expiresAt);
    if (!BEARER_PATTERN.test(bearer) || (expiresAt && declared === null)) return false;

    this.commit(kind, { pending: true, expiresAt: declared });
    // The decision that has to win is the caller's latest one, not the last
    // answer to arrive: a park still in flight when the handoff is discarded or
    // hidden must not put it back. Every park carries the revision it was issued
    // at, and an answer whose revision moved is dropped.
    const issued = this.revision(kind);
    const request = this.api
      .post<ParkReceipt>(
        `/api/v1/pending/${kind}`,
        declared === null ? { token: bearer } : { token: bearer, expiresAt: declared },
        decodeParkReceipt,
      )
      .then((receipt) => {
        if (this.superseded(kind, issued)) return false;
        this.adopt(kind, { pending: true, expiresAt: receipt.expiresAt });
        this.outcomes.update((all) => ({ ...all, [kind]: true }));
        return true;
      })
      .catch(() => {
        if (this.superseded(kind, issued)) return false;
        // The panel must not offer a flow whose credential the browser does not
        // hold, so a refused park is reverted rather than kept optimistically.
        this.commit(kind, NOT_PARKED);
        this.outcomes.update((all) => ({ ...all, [kind]: false }));
        return false;
      })
      .finally(() => {
        if (this.parking.get(kind) === request) this.parking.delete(kind);
      });

    this.parking.set(kind, request);
    return true;
  }

  /** Resolves once the server has taken (or refused) the latest `park()`. */
  confirmed(kind: HandoffKind): Promise<boolean> {
    return this.parking.get(kind) ?? Promise.resolve(this.parked(kind));
  }

  /** Stop holding a live handoff: the server is asked to drop it, cookie included. */
  async forget(kind: HandoffKind): Promise<void> {
    this.commit(kind, NOT_PARKED);
    try {
      await this.api.delete(`/api/v1/pending/${kind}`);
    } catch {
      // The handoff is already hidden here, and a request that failed leaves the
      // cookie in place: the next `refresh()` restores the truth, which is the
      // safe direction — a handoff re-offered, never one silently lost.
    }
  }

  /** Forget a handoff the server has already dropped as part of its own answer. */
  hide(kind: HandoffKind): void {
    this.commit(kind, NOT_PARKED);
  }

  /**
   * Ask the server which handoffs this browser is holding.
   *
   * Called once at startup and safe to call again: concurrent callers share one
   * request, and an unreachable park leaves the previous answer untouched
   * instead of inventing one.
   */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.api
      .get<ParkedHandoffs>("/api/v1/pending", undefined, decodeParkedHandoffs)
      .then((parked) => {
        this.adopt("invitation", parked.invitation);
        this.adopt("link-intent", parked["link-intent"]);
      })
      .catch(() => undefined)
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  /** Whether the park a request belongs to has been replaced since it started. */
  private superseded(kind: HandoffKind, issued: number): boolean {
    return this.revision(kind) !== issued;
  }

  /** The deadline a caller declared, normalized, or null when it is unusable. */
  private declaredExpiry(value: string | null | undefined): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) return null;
    return new Date(parsed).toISOString();
  }

  /** A change the caller caused: the identity changes even if the state does not. */
  private commit(kind: HandoffKind, state: HandoffState): void {
    this.states.update((all) => ({ ...all, [kind]: state }));
    this.revisions.update((all) => ({ ...all, [kind]: all[kind] + 1 }));
  }

  /** A change the server reported: the identity only moves when the answer did. */
  private adopt(kind: HandoffKind, state: HandoffState): void {
    const previous = this.states()[kind];
    if (previous.pending === state.pending && previous.expiresAt === state.expiresAt) return;
    this.states.update((all) => ({ ...all, [kind]: state }));
    this.revisions.update((all) => ({ ...all, [kind]: all[kind] + 1 }));
  }
}
