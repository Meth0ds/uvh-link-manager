import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable } from "rxjs";
import { LinkDialogComponent, type LinkDialogData, type LinkDialogResult } from "./link-dialog.component";
import type { LinkDto } from "../../core/models";

@Injectable({ providedIn: "root" })
export class LinkDialogService {
  private dialog = inject(MatDialog);

  openCreate(initialDestination = ""): Observable<LinkDto | null> {
    return this.open({ mode: "create", initialDestination });
  }

  openEdit(link: LinkDto): Observable<LinkDto | null> {
    return this.open({ mode: "edit", link });
  }

  private open(data: LinkDialogData): Observable<LinkDto | null> {
    const ref = this.dialog.open(LinkDialogComponent, {
      data,
      width: "min(720px, 94vw)",
      maxHeight: "92vh",
      disableClose: true,
      autoFocus: false,
    });
    return ref.afterClosed() as Observable<LinkDto | null>;
  }
}

export type { LinkDialogData, LinkDialogResult };
