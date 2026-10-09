import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { firstValueFrom } from "rxjs";
import {
  ActionDialogComponent,
  type ActionDialogData,
  type ActionDialogResult,
} from "./action-dialog.component";

@Injectable({ providedIn: "root" })
export class ActionDialogService {
  private readonly dialog = inject(MatDialog);

  confirm(options: Pick<ActionDialogData, "title" | "message" | "confirmLabel"> & { destructive?: boolean }): Promise<boolean> {
    const ref = this.dialog.open<ActionDialogComponent, ActionDialogData, ActionDialogResult>(ActionDialogComponent, {
      data: { ...options },
      width: "min(460px, 92vw)",
      maxWidth: "92vw",
      autoFocus: "first-tabbable",
      role: "alertdialog",
    });
    return firstValueFrom(ref.afterClosed()).then((result) => result === true);
  }

  prompt(options: Pick<ActionDialogData, "title" | "message" | "confirmLabel" | "inputLabel"> & {
    destructive?: boolean;
    inputValue?: string;
    inputMultiline?: boolean;
    inputPlaceholder?: string;
    inputHint?: string;
    inputRequired?: boolean;
    inputMinLength?: number;
    inputMaxLength?: number;
  }, lifetime?: { signal: AbortSignal }): Promise<string | null> {
    if (lifetime?.signal.aborted) return Promise.resolve(null);
    const ref = this.dialog.open<ActionDialogComponent, ActionDialogData, ActionDialogResult>(ActionDialogComponent, {
      data: { ...options },
      width: "min(500px, 92vw)",
      maxWidth: "92vw",
      autoFocus: "first-tabbable",
      role: "alertdialog",
    });
    const cancel = () => ref.close(null);
    lifetime?.signal.addEventListener("abort", cancel, { once: true });
    return firstValueFrom(ref.afterClosed())
      .then((result) => typeof result === "string" ? result : null)
      .finally(() => lifetime?.signal.removeEventListener("abort", cancel));
  }
}
