import type { DestroyRef } from "@angular/core";
import type { RecoveryAdminApi } from "./recovery-admin-api";

/** Owns only the popup handshake, never the independently authenticated page. */
export class RecoveryPortal {
  private cancel: (() => void) | null = null;

  constructor(private readonly api: RecoveryAdminApi, destroy: DestroyRef) {
    destroy.onDestroy(() => this.cancel?.());
  }

  async open(password: string, factorCode: string, current: () => boolean, error: (message: string) => void): Promise<boolean> {
    const popup = window.open("/__uvh/admin", "_blank");
    if (!popup) {
      error($localize`:@@recovery.popupError:Permite abrir la ventana del centro de recuperación y vuelve a intentarlo.`);
      return false;
    }
    let ready = false, ticket: string | null = null, delivered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finish: (() => void) | undefined;
    const deliver = () => {
      if (ready && ticket && current() && !popup.closed) {
        popup.postMessage({ type: "uvh-recovery-ticket", ticket }, window.location.origin);
        ticket = null; delivered = true; finish?.();
      }
    };
    const listener = (event: MessageEvent) => {
      if (event.source === popup && event.origin === window.location.origin && event.data?.type === "uvh-recovery-ready") {
        ready = true; deliver();
      }
    };
    const cancel = () => {
      ticket = null; clearTimeout(timer); window.removeEventListener("message", listener);
      if (!delivered) popup.close();
      finish?.();
    };
    this.cancel = cancel;
    window.addEventListener("message", listener);
    try {
      ticket = await this.api.access(password, factorCode);
      if (!current()) { popup.close(); return true; }
      deliver();
      if (ticket) await new Promise<void>(resolve => { finish = resolve; timer = setTimeout(resolve, 10000); });
      if (ticket && current()) error($localize`:@@recovery.portalError:No se pudo conectar con la página de recuperación. Comprueba que el controlador siga abierto.`);
    } catch (cause) { popup.close(); throw cause; }
    finally { cancel(); if (this.cancel === cancel) this.cancel = null; }
    return true;
  }
}
