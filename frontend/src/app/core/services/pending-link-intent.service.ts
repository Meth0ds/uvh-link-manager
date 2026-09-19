import { Injectable, computed, inject, type Signal } from "@angular/core";
import { ApiRequestError, ApiService } from "./api.service";
import { decodeClaimedLinkIntent, decodeLinkIntentReceipt } from "./link-intent-response-decoders";
import { PendingHandoffService } from "./pending-handoff.service";

export interface LinkIntentReceipt {
  intent: string;
  expiresAt: string;
}

export interface ClaimedLinkIntent {
  destination: string;
  expiresAt: string;
}

/** What the panel knows about a parked link intent: when it stops being valid. */
export interface PendingLinkIntent {
  expiresAt: string | null;
}

/**
 * Carries an opaque pending-link token after the public site hands the user
 * over to the app host. The raw destination is only retrieved after verified
 * authentication, so it never needs to live in an auth URL or browser history.
 *
 * The opaque token itself no longer lives in this browser either: it is parked
 * server-side in an HttpOnly cookie (`PendingHandoffService`), so `capture()`
 * hands it over instead of keeping it, and `claim()`/`complete()` send no
 * bearer at all — the server reads the cookie.
 */
@Injectable({ providedIn: "root" })
export class PendingLinkIntentService {
  private readonly api = inject(ApiService);
  private readonly handoff = inject(PendingHandoffService);

  readonly pending: Signal<PendingLinkIntent | null> = computed(() => {
    const parked = this.handoff.linkIntent();
    return parked.pending ? { expiresAt: parked.expiresAt } : null;
  });
  readonly hasPending: Signal<boolean> = computed(() => this.handoff.linkIntent().pending);
  /** Changes whenever the parked intent changes; see `PendingInvitationService`. */
  readonly revision: Signal<number> = computed(() => this.handoff.revision("link-intent"));

  async create(destination: string): Promise<LinkIntentReceipt> {
    return this.api.post<LinkIntentReceipt>("/api/v1/link-intents", { destination }, decodeLinkIntentReceipt);
  }

  /**
   * Park a token read from the app-host URL, so the route can be rewritten
   * without the browser keeping the bearer.
   */
  capture(intent: string, expiresAt?: string | null): boolean {
    return this.handoff.park("link-intent", intent, expiresAt);
  }

  /** Resolves once the server has taken (or refused) the park. */
  confirmed(): Promise<boolean> {
    return this.handoff.confirmed("link-intent");
  }

  async claim(): Promise<ClaimedLinkIntent | null> {
    if (!this.handoff.parked("link-intent")) return null;
    // The server consumes the cookie, so the park has to have landed before the
    // claim can mean anything. A park still in flight would answer 404 here.
    if (!await this.handoff.confirmed("link-intent")) return null;

    try {
      return await this.api.post<ClaimedLinkIntent>("/api/v1/link-intents/claim", {}, decodeClaimedLinkIntent);
    } catch (error) {
      // A 404 is terminal: the server has already dropped the cookie, so the
      // panel stops offering a link that is gone, expired or somebody else's.
      if (error instanceof ApiRequestError && error.status === 404) this.handoff.hide("link-intent");
      throw error;
    }
  }

  /**
   * Consume the intent after creating or discarding the link.
   *
   * The CTA disappears immediately, then the server is asked to release the
   * record. If that call fails the browser still drops its copy, so the panel
   * does not keep offering a link the user already walked away from; the
   * server-side record simply expires on its own.
   */
  async complete(): Promise<void> {
    this.handoff.hide("link-intent");
    try {
      await this.api.post<{ ok: true }>("/api/v1/link-intents/complete", {});
    } catch {
      await this.handoff.forget("link-intent");
    }
  }

  /** Drop the intent from this browser without claiming anything. */
  async clear(): Promise<void> {
    await this.handoff.forget("link-intent");
  }

  /** Re-ask the server which handoffs this browser holds. */
  refresh(): Promise<void> {
    return this.handoff.refresh();
  }
}
