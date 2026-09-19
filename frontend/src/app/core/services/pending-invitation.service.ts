import { Injectable, computed, inject, type Signal } from "@angular/core";
import { PendingHandoffService } from "./pending-handoff.service";

/**
 * Same-browser handoff for an invitation bearer.
 *
 * The bearer used to live in `localStorage` for up to seven days, where any
 * script on the origin could read it. It is now handed to the server once and
 * held in an HttpOnly cookie, which is why this service can no longer return a
 * token: there is none to return. What it exposes instead is whether a park
 * exists, an opaque revision for request-ordering, and the means to park or
 * drop one.
 */
@Injectable({ providedIn: "root" })
export class PendingInvitationService {
  private readonly handoff = inject(PendingHandoffService);

  /** Whether this browser is holding an invitation it has not spent yet. */
  readonly pending: Signal<boolean> = computed(() => this.handoff.invitation().pending);

  /** Deadline of the parked invitation, once the server has confirmed it. */
  readonly expiresAt: Signal<string | null> = computed(() => this.handoff.invitation().expiresAt);

  /**
   * Changes every time the parked invitation changes. Callers that await a
   * request use it to tell "the park I started with" from "another one".
   */
  readonly revision: Signal<number> = computed(() => this.handoff.revision("invitation"));

  /**
   * Whether the browser ended up holding the invitation: `null` until a park
   * has been attempted. A refused park is the case that used to be a blocked
   * `localStorage`, and it needs different copy: nothing was stored at all.
   */
  readonly persistent: Signal<boolean | null> = this.handoff.invitationOutcome;

  /** Park a bearer read from a link. False when there is nothing usable to park. */
  capture(token: string, expiresAt?: string | null): boolean {
    return this.handoff.park("invitation", token, expiresAt);
  }

  /** Resolves once the server has taken (or refused) the park. */
  confirmed(): Promise<boolean> {
    return this.handoff.confirmed("invitation");
  }

  /** Stop holding the invitation and ask the server to drop it. */
  forget(): Promise<void> {
    return this.handoff.forget("invitation");
  }

  /** Forget an invitation the server already dropped (accepted or rejected). */
  hide(): void {
    this.handoff.hide("invitation");
  }

  /**
   * Re-ask the server whether an invitation is parked.
   *
   * A visitor who logs in and comes back to `/invitations/accept` has no bearer
   * left in the URL — the park is what returns them there — so this is the only
   * way that visit can learn whether the invitation is still alive.
   */
  refresh(): Promise<void> {
    return this.handoff.refresh();
  }
}
