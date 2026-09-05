import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { LinkDialogComponent, type LinkDialogData } from "./link-dialog.component";
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
    const ref = this.dialog.open<LinkDialogComponent, LinkDialogData, LinkDto>(LinkDialogComponent, {
      data,
      width: "min(820px, 94vw)",
      maxHeight: "92vh",
      disableClose: true,
      autoFocus: false,
    });
    return ref.afterClosed().pipe(map((link) => link ?? null));
  }
}

export type { LinkDialogData };
