import { Injectable, signal } from "@angular/core";
import type { AuthUser } from "../models";

/**
 * Local user projection and transition clock shared by auth and HTTP dispatch.
 * Contains no credential or authorization policy and never depends on HTTP.
 * Reactive reads let mounted views invalidate work even when logout fails
 * before the user projection changes.
 */
@Injectable({ providedIn: "root" })
export class SessionContextService {
  readonly user = signal<AuthUser | null>(null);
  private readonly revision = signal(0);
  readonly generation = this.revision.asReadonly();

  advance(): number {
    this.revision.update((current) => current + 1);
    return this.revision();
  }
}
