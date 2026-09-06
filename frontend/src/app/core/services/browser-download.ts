const REVOKE_DELAY_MS = 1_000;

/**
 * Starts a browser download and keeps its object URL alive long enough for the
 * navigation task to consume it. Returns false when browser APIs reject it.
 */
export function downloadBlob(
  blob: Blob,
  filename: string,
  view: Window = window,
  doc: Document = document,
  urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): boolean {
  let url: string | null = null;
  try {
    const createdUrl = urlApi.createObjectURL(blob);
    url = createdUrl;
    const anchor = doc.createElement("a");
    anchor.href = createdUrl;
    anchor.download = filename.replace(/[\u0000-\u001f\u007f/\\]/g, "-").slice(0, 180) || "download";
    anchor.rel = "noopener";
    anchor.click();
    view.setTimeout(() => urlApi.revokeObjectURL(createdUrl), REVOKE_DELAY_MS);
    return true;
  } catch {
    if (url) {
      try { urlApi.revokeObjectURL(url); } catch { /* browser cleanup is best-effort */ }
    }
    return false;
  }
}
