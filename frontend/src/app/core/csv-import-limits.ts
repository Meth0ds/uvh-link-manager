/** Matches LinkCsvController::MAX_IMPORT_BYTES; the server remains authoritative. */
export const MAX_CSV_IMPORT_BYTES = 262_144;

/** File.text() removes a UTF-8 BOM, so allow its three raw bytes in preflight. */
export function csvFileCanFit(size: number): boolean {
  return size <= MAX_CSV_IMPORT_BYTES + 3;
}

/**
 * Bound allocation before encoding: UTF-8 uses at least one byte and at most
 * three bytes per UTF-16 code unit (a surrogate pair uses four for two units).
 * Only the uncertain middle range needs an encoder, capped at 768 KiB.
 */
export function csvTextWithinLimit(text: string): boolean {
  if (text.length > MAX_CSV_IMPORT_BYTES) return false;
  if (text.length <= Math.floor(MAX_CSV_IMPORT_BYTES / 3)) return true;
  return new TextEncoder().encode(text).byteLength <= MAX_CSV_IMPORT_BYTES;
}
