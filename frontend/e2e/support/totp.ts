import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode the RFC 4648 secret shown by the application without extra packages. */
function decodeBase32(secret: string): Buffer {
  let bits = "";
  for (const character of secret.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) throw new Error("The MFA setup returned an invalid Base32 secret.");
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Generate the six-digit SHA-1 TOTP used by the backend's 30-second window. */
export function currentTotp(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
