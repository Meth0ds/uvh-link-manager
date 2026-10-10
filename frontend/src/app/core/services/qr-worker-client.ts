import type { QrWorkerRequest } from "./qr-export.worker";
import { isDevMode } from "@angular/core";

interface QrTrustedPolicy { createScriptURL(value: string): unknown }
interface QrTrustedTypes {
  createPolicy(name: string, rules: { createScriptURL(value: string): string }): QrTrustedPolicy;
}
let policy: QrTrustedPolicy | undefined;

export function validateQrWorkerUrl(url: URL, moduleUrl: URL, pageOrigin: string, development: boolean): void {
  const directory = moduleUrl.pathname.slice(0, moduleUrl.pathname.lastIndexOf("/") + 1);
  const filename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  const allowedQuery = !url.search || (development && url.search === "?worker_file&type=module");
  if (url.origin !== pageOrigin || url.origin !== moduleUrl.origin || !allowedQuery || url.hash || url.username || url.password
    || url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) !== directory
    || !/^worker-[a-zA-Z0-9_-]+\.js$/.test(filename)) throw new Error("Recurso del generador QR inválido.");
}

function trustedWorkerUrl(url: URL): string | URL {
  // Inspect the module URL directly: Vite rewrites new URL(".", import.meta.url)
  // to a filesystem path, while its generated workers are served beside chunks.
  validateQrWorkerUrl(url, new URL(import.meta.url), location.origin, isDevMode());
  const factory = (globalThis as typeof globalThis & { trustedTypes?: QrTrustedTypes }).trustedTypes;
  if (!factory) return url;
  policy ??= factory.createPolicy("uvh#qr-worker", { createScriptURL(value) {
    // The caller admits only a compiler-generated, same-directory worker URL.
    const candidate = new URL(value);
    if (candidate.href !== url.href) throw new Error("Recurso del generador QR inválido.");
    return candidate.href;
  } });
  return policy.createScriptURL(url.href) as string;
}

export function runQrWorker(request: QrWorkerRequest, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException("Exportación cancelada", "AbortError")); return; }
    let worker: Worker;
    // Keep Angular's statically recognizable Worker(new URL(...)) expression.
    // The native constructor receives a narrowly scoped TrustedScriptURL.
    const Worker = class extends globalThis.Worker {
      constructor(url: URL, options: WorkerOptions) { super(trustedWorkerUrl(url), options); }
    };
    try { worker = new Worker(new URL("./qr-export.worker", import.meta.url), { type: "module" }); }
    catch { reject(new Error("Este navegador no pudo iniciar la exportación en segundo plano. Reinténtalo en un navegador actualizado.")); return; }
    let settled = false;
    const finish = (error?: Error, blob?: Blob) => {
      if (settled) return; settled = true; worker.terminate(); clearTimeout(deadline); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(blob!);
    };
    const abort = () => finish(new DOMException("Exportación cancelada", "AbortError"));
    const deadline = setTimeout(() => finish(new Error("La exportación tardó demasiado. Reduce el lote o la resolución y reinténtalo.")), 5 * 60_000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error("La exportación se interrumpió. No se ha descargado ningún archivo incompleto.")); };
    worker.onmessageerror = () => finish(new Error("No se pudo recibir el archivo QR."));
    worker.onmessage = ({ data }: MessageEvent) => {
      if (settled) return;
      if (signal?.aborted) { abort(); return; }
      if (data?.kind === "progress" && Number.isInteger(data.done) && Number.isInteger(data.total)) progress?.(data.done, data.total);
      else if (data?.kind === "done" && data.blob instanceof Blob) {
        if (data.blob.size > 64 * 1024 * 1024) finish(new Error("El archivo supera el límite de 64 MB.")); else finish(undefined, data.blob);
      } else if (data?.kind === "error") finish(new Error(typeof data.message === "string" ? data.message : "No se pudo exportar el QR."));
    };
    try { worker.postMessage(request); } catch { finish(new Error("No se pudo enviar el diseño al generador QR.")); }
  });
}
