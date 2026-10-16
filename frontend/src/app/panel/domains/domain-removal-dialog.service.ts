import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { firstValueFrom } from "rxjs";
import type { DomainDto } from "../../core/models";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";

export interface DomainRemovalDialogData { domainId: number; domain: string; workspaceId: number }
export interface DomainRemovalDialogResult { deleted: boolean; changed: boolean }

@Injectable({ providedIn: "root" })
export class DomainRemovalDialogService {
  private readonly dialog = inject(MatDialog);
  private readonly workspaces = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);

  async open(domain: DomainDto, lifetime?: { signal: AbortSignal }): Promise<DomainRemovalDialogResult | undefined> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    const generation = this.session.generation();
    const userId = this.session.user()?.id;
    if (lifetime?.signal.aborted || workspaceId === null || (role !== "owner" && role !== "admin")) return;
    const { DomainRemovalDialogComponent } = await import("./domain-removal-dialog.component");
    if (lifetime?.signal.aborted || this.workspaces.currentId() !== workspaceId || this.workspaces.currentRole() !== role || this.session.generation() !== generation || this.session.user()?.id !== userId) return;
    const ref = this.dialog.open<InstanceType<typeof DomainRemovalDialogComponent>, DomainRemovalDialogData, DomainRemovalDialogResult>(DomainRemovalDialogComponent, {
      data: { domainId: domain.id, domain: domain.domain, workspaceId },
      width: "min(880px, 96vw)", maxWidth: "96vw", autoFocus: "first-heading", restoreFocus: true,
    });
    const cancel = () => ref.close();
    lifetime?.signal.addEventListener("abort", cancel, { once: true });
    try { return await firstValueFrom(ref.afterClosed()); }
    finally { lifetime?.signal.removeEventListener("abort", cancel); }
  }
}
