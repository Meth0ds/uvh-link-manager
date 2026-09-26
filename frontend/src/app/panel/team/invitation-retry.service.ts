import { DestroyRef, Injectable, inject } from "@angular/core";
import { RetryCountdown, formatWaitLabel } from "../../core/retry-countdown";

/** Component-local UX advice, never an authorization or rate-limit boundary. */
@Injectable()
export class InvitationRetryService {
  private readonly countdown = new RetryCountdown(inject(DestroyRef));

  remaining(workspaceId: number, email: string): number {
    return this.countdown.remaining(this.key(workspaceId, email));
  }

  defer(workspaceId: number, email: string, seconds: number | undefined): void {
    this.countdown.defer(this.key(workspaceId, email), seconds);
  }

  label(seconds: number): string {
    return formatWaitLabel(seconds);
  }

  private key(workspaceId: number, email: string): string {
    // Create and resend share the same recipient. Do not infer whether the
    // server exhausted recipient, actor, IP or global quota from a generic 429.
    return `${workspaceId}:${email.trim().toLowerCase()}`;
  }
}
