import { randomBytes, randomInt, createHash } from "node:crypto";

// URL-safe alphabet without visually ambiguous characters (0/O, 1/l/I, etc.)
export const ALIAS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function randomAlias(length = 8): string {
  // randomInt is a CSPRNG with rejection sampling: no modulo bias.
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALIAS_ALPHABET[randomInt(0, ALIAS_ALPHABET.length)]!;
  }
  return out;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomCode(): string {
  // 6-digit numeric code from a CSPRNG
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
