import { Injectable, signal } from "@angular/core";
import type { Workspace } from "../models";

const STORAGE_KEY = "uvh.workspaceId";

@Injectable({ providedIn: "root" })
export class WorkspaceService {
  /** All workspaces the current user belongs to. */
  readonly list = signal<Workspace[]>([]);
  /** The currently selected workspace id used for the X-Workspace-Id header. */
  readonly currentId = signal<number | null>(this.readStored());

  private readStored(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  setList(workspaces: Workspace[]): void {
    this.list.set(workspaces);
    const current = this.currentId();
    if (!current || !workspaces.some((w) => w.id === current)) {
      this.select(workspaces[0]?.id ?? null);
    }
  }

  select(id: number | null): void {
    // This value becomes an authorization-context header. Reject fractional,
    // negative and unsafe IDs even when a caller bypasses the workspace list.
    const selected = id !== null && Number.isSafeInteger(id) && id > 0 ? id : null;
    this.currentId.set(selected);
    try {
      if (selected === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(selected));
    } catch {
      /* ignore */
    }
  }

  /** Role of the current user in the selected workspace (for UI capability). */
  currentRole(): Workspace["role"] {
    const ws = this.list().find((w) => w.id === this.currentId());
    return ws?.role ?? null;
  }
}
