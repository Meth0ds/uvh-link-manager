import { computed, effect, signal, untracked, type DestroyRef } from "@angular/core";
import { OwnedMutations } from "../../core/services/owned-mutations";
import type { SessionContextService } from "../../core/services/session-context.service";

export type AdminIntent = () => boolean;

/** Per-view lifetime and intent identity. Backend permission and fresh MFA remain authoritative. */
export class AdminViewContext {
  readonly key = computed(() => {
    const user = this.session.user();
    return JSON.stringify([this.session.generation(), user?.id, user?.isAdmin, user?.emailVerified, user?.mfaEnabled]);
  });
  readonly eligible = computed(() => {
    const user = this.session.user();
    return user?.isAdmin === true && user.emailVerified === true && user.mfaEnabled === true;
  });
  private readonly mutations = new OwnedMutations();
  private readonly label = signal<string | null>(null);
  readonly actionKey = this.label.asReadonly();
  readonly busy = this.mutations.busy;
  private renderedContext: string;

  constructor(private readonly session: SessionContextService, private readonly destroyRef: DestroyRef) {
    this.renderedContext = this.key();
    effect(() => {
      const context = this.key();
      if (context === this.renderedContext) return;
      untracked(() => {
        this.renderedContext = context;
        this.mutations.reset();
        this.label.set(null);
      });
    });
    destroyRef.onDestroy(() => {
      this.mutations.reset();
      this.label.set(null);
    });
  }

  /** Capture before opening a dialog; reject transitions even before an effect runs. */
  capture(): AdminIntent {
    const context = this.key();
    return () => !this.destroyRef.destroyed && this.eligible()
      && this.renderedContext === context && this.key() === context;
  }

  /** A command owns its slot. A superseded command neither publishes nor releases a newer one. */
  begin(label: string, intent: AdminIntent): { isCurrent: AdminIntent; settle: () => void } | null {
    if (!intent() || this.busy()) return null;
    const operation = this.mutations.begin(0);
    this.label.set(label);
    return {
      isCurrent: () => intent() && this.mutations.isCurrent(operation),
      settle: () => {
        if (!this.mutations.isCurrent(operation)) return;
        this.mutations.settle(operation);
        this.label.set(null);
      },
    };
  }
}
