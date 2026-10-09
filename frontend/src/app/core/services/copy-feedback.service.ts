import { DOCUMENT } from "@angular/common";
import { DestroyRef, Injectable, inject, signal } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import { SessionContextService } from "./session-context.service";

export type CopyPhase = "idle" | "copying" | "copied" | "error";
interface CopyAttempt {
  readonly url: string;
  readonly generation: number;
  readonly scope: string;
  readonly context: () => string;
  readonly phase: CopyPhase;
}

/** Provide per view. Clipboard permission promises cannot be cancelled, so
 * their UI acknowledgement belongs to the initiating session and view only. */
@Injectable()
export class CopyFeedbackService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionContextService);
  private readonly snack = inject(MatSnackBar);
  private readonly attempt = signal<CopyAttempt | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;

  constructor() {
    this.destroyRef.onDestroy(() => { this.revision++; this.clearTimer(); });
  }

  phase(url: string, context: () => string): CopyPhase {
    const attempt = this.attempt();
    return attempt?.url === url && this.current(attempt) && attempt.scope === context() ? attempt.phase : "idle";
  }

  busy(): boolean {
    const attempt = this.attempt();
    return attempt?.phase === "copying" && this.current(attempt);
  }

  copy(url: string, context: () => string): void {
    if (this.destroyRef.destroyed) return;
    const previous = this.attempt();
    // Coalesce pending writes even if a second copy control is activated.
    if (previous?.phase === "copying" && this.current(previous)) return;
    this.clearTimer();
    const revision = ++this.revision;
    const attempt: CopyAttempt = { url, generation: this.session.generation(), scope: context(), context, phase: "copying" };
    this.attempt.set(attempt);
    let settled = false;
    const finish = (phase: "copied" | "error", message: string) => {
      if (revision !== this.revision || settled || this.destroyRef.destroyed) return;
      settled = true;
      this.clearTimer();
      if (!this.current(attempt)) { this.attempt.set(null); return; }
      this.attempt.set({ ...attempt, phase });
      this.snack.open(message, "Cerrar", { duration: phase === "copied" ? 2000 : 3000 });
      this.timer = setTimeout(() => { if (revision === this.revision) this.attempt.set(null); this.timer = undefined; }, 2400);
    };
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;
      if (!clipboard) { finish("error", "El navegador no permite copiar automáticamente"); return; }
      // Call directly in the click stack to retain browser user activation.
      const write = clipboard.writeText(url);
      this.timer = setTimeout(() => {
        finish("error", "No se pudo confirmar la copia. Puedes volver a intentarlo.");
      }, 20000);
      void write.then(() => finish("copied", "Enlace copiado"), () => finish("error", "No se pudo copiar. Puedes volver a intentarlo."));
    } catch {
      finish("error", "No se pudo copiar. Puedes volver a intentarlo.");
    }
  }

  private current(attempt: CopyAttempt): boolean {
    return !this.destroyRef.destroyed && attempt.generation === this.session.generation() && attempt.scope === attempt.context();
  }
  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
}
