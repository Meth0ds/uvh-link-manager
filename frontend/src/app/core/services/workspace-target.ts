import type { WorkspaceService } from "./workspace.service";

/**
 * The workspace a pending decision belongs to.
 *
 * A confirmation dialog, a password/factor prompt or a slow request can outlive
 * the selection they were opened for: the panel header stays usable while they
 * are open, and every resource id in the panel (`/links/12`, `/domains/7`) is
 * only meaningful inside one tenant. The answer that comes back names a resource
 * of the workspace that asked the question, so a mutation must re-check the
 * selection before it sends the request, publishes a result or clears a busy
 * flag. Otherwise the same numeric id is applied to another tenant's row.
 *
 * `targetWorkspace()` captures the selection once and keeps that comparison in
 * one place instead of repeating a local `workspaceId` in every handler.
 *
 * The captured value is deliberately a plain number, not a signal: the point is
 * to remember what was true when the decision started, never to follow the
 * current selection.
 */
export interface WorkspaceTarget {
  /** Workspace the decision acts on; null when there is none. */
  readonly workspaceId: number | null;
  /** True while that same workspace is still the selected one. */
  isCurrent(): boolean;
}

/**
 * Capture the workspace an in-flight decision acts on.
 *
 * Call it *before* the first `await` of the handler. A target built after a
 * dialog closes would compare the new selection with itself and always pass.
 *
 * `ownerId` is the workspace that already owns the data being acted on — a
 * member row read from `detail()`, for instance. Pass it whenever it is known:
 * the decision must name *that* workspace, and it must still be the selected
 * one, so a stale row can never be applied to whatever tenant comes next. Omit
 * it when the data at hand carries no workspace of its own and the current
 * selection is the only available answer.
 */
export function targetWorkspace(workspaces: WorkspaceService, ownerId?: number | null): WorkspaceTarget {
  const workspaceId = ownerId === undefined ? workspaces.currentId() : ownerId;

  return {
    workspaceId,
    // A decision that named no workspace has no current target: the mutation
    // would otherwise be sent with whatever workspace the header selects later.
    isCurrent: () => workspaceId !== null && workspaces.currentId() === workspaceId,
  };
}
