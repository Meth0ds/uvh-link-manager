import type { AuthUser } from "../models";

interface MutationGroup {
  readonly generation: number;
  readonly account: number | null;
  pending: number;
  reconcile: boolean;
  confirmed: boolean;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

/**
 * Full User snapshots have no server revision. Overlapping commands cannot be
 * ordered by request start or response arrival: read once after they settle.
 * Commands run immediately; this retains no password queue and never retries.
 */
export class AuthUserMutations {
  private active?: MutationGroup;

  constructor(
    private readonly assertContext: (generation: number, account: number | null) => void,
    private readonly publish: (user: AuthUser) => void,
    /** Refresh absorbs read failures separately from committed command results. */
    private readonly refresh: (generation: number, account: number | null) => Promise<void>,
  ) {}

  /** A concurrent identity read may reflect a newer security commit. */
  identityRead(): void {
    if (this.active) this.active.reconcile = true;
  }

  async run(generation: number, account: number | null, command: () => Promise<AuthUser>, needsReconciliation = false): Promise<AuthUser> {
    let group = this.active;
    if (!group || group.generation !== generation || group.account !== account) {
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      group = { generation, account, pending: 0, reconcile: needsReconciliation, confirmed: false, settled, settle };
      this.active = group;
    }
    if (++group.pending > 1 || needsReconciliation) group.reconcile = true;
    let user: AuthUser;
    try {
      user = await command();
      this.assertContext(generation, account);
      group.confirmed = true;
      if (!group.reconcile) this.publish(user);
    } finally {
      if (--group.pending === 0) {
        if (this.active === group) this.active = undefined;
        if (group.confirmed && group.reconcile) {
          // The facade owns failed refresh feedback. Always release successful
          // callers, including when the account/injector has been superseded.
          void this.refresh(generation, account).then(group.settle, group.settle);
        } else {
          group.settle();
        }
      }
    }
    if (group.reconcile) await group.settled;
    this.assertContext(generation, account);
    return user;
  }
}
