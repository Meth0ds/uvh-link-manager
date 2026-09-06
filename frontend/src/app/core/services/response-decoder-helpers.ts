export type JsonRecord = Record<string, unknown>;

export function invalid(contract: string): never {
  throw new Error(`Invalid ${contract} response`);
}

export function record(value: unknown, contract: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(contract);
  return value as JsonRecord;
}

export function integer(value: unknown, contract: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(contract);
  return value as number;
}

export function finiteNumber(value: unknown, contract: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) invalid(contract);
  return value;
}

export function boolean(value: unknown, contract: string): boolean {
  if (typeof value !== "boolean") invalid(contract);
  return value;
}

export function text(value: unknown, contract: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum
    || /[\x00-\x1f\x7f]/.test(value)) {
    invalid(contract);
  }
  return value;
}

export function nullableText(value: unknown, contract: string, maximum: number, allowEmpty = false): string | null {
  return value === null ? null : text(value, contract, maximum, allowEmpty);
}

export function literal<T extends string>(value: unknown, allowed: ReadonlySet<T>, contract: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) invalid(contract);
  return value as T;
}

export function httpUrl(value: unknown, contract: string): string {
  const decoded = text(value, contract, 2048);
  if (decoded.includes("\\")) invalid(contract);
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    invalid(contract);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname || parsed.username || parsed.password) {
    invalid(contract);
  }
  return decoded;
}

export function boundedArray(value: unknown, contract: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(contract);
  return value;
}

export function nullableInteger(value: unknown, contract: string, minimum = 0): number | null {
  return value === null ? null : integer(value, contract, minimum);
}

export function countRecord(value: unknown, contract: string, maximumKeys = 64): Record<string, number> {
  const source = record(value, contract);
  const entries = Object.entries(source);
  if (entries.length > maximumKeys) invalid(contract);
  const decoded: Record<string, number> = {};
  for (const [key, count] of entries) {
    decoded[text(key, contract, 100)] = integer(count, contract);
  }
  return decoded;
}
