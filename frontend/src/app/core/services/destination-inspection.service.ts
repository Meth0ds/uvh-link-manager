import { Injectable, inject } from "@angular/core";
import { ApiService } from "./api.service";
import { decodeInspection } from "./link-workflow-decoders";
import type { DestinationInspection } from "../link-workflows";

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
@Injectable({ providedIn: "root" })
export class DestinationInspectionService {
  private readonly api = inject(ApiService);
  async inspect(target: { url: string } | { linkId: number; linkVersion: number }, signal: AbortSignal): Promise<DestinationInspection> {
    signal.throwIfAborted();
    let inspection = "url" in target
      ? await this.api.post("/api/v1/destination-previews", { url: target.url }, decodeInspection)
      : await this.api.post(`/api/v1/links/${target.linkId}/destination-inspection`, { linkVersion: target.linkVersion }, decodeInspection);
    signal.throwIfAborted();
    const deadline = Date.now() + 30_000;
    while (inspection.status === "pending") {
      if (Date.now() >= deadline) throw new Error("La comprobación está tardando más de lo previsto. Puedes volver a intentarlo.");
      await pause(750, signal);
      const expectedId = inspection.id;
      inspection = await this.api.get(`/api/v1/destination-inspections/${expectedId}`, undefined, decodeInspection, { signal });
      if (inspection.id !== expectedId) throw new Error("La comprobación recibida no corresponde a esta solicitud.");
    }
    if (inspection.status === "stale") throw new Error("El destino o tus permisos han cambiado. Inicia otra comprobación.");
    return inspection;
  }
  async icon(path: string, signal: AbortSignal): Promise<Blob> {
    const blob = await this.api.getBlob(path, undefined, { signal });
    if (blob.type !== "image/png" || blob.size > 262144) throw new Error("Icono no válido.");
    return blob;
  }
}
