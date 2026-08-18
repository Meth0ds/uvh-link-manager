import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Encryption at rest for secrets that must remain *recoverable* (TOTP secret,
 * webhook signing secret). Uses AES-256-GCM with a key derived from APP_SECRET
 * via domain-separated HMAC so a database leak alone does not expose them.
 *
 * Values written before this helper existed are returned as-is (legacy plaintext),
 * so existing rows keep working until they are rewritten.
 */
const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

function key(): Buffer {
  // 32-byte key, domain-separated so it is not reused for signatures/sessions.
  return createHmac("sha256", config.appSecret).update("uvh:at-rest:v1").digest();
}

export function encryptAtRest(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * Pseudonymous IP hash for audit/session records: HMAC with the app secret
 * so IPv4 addresses (2^32 space) cannot be reversed with rainbow tables.
 */
export function hashIp(ip: string): string {
  return createHmac("sha256", config.appSecret).update("ip:" + ip).digest("hex").slice(0, 32);
}

export function decryptAtRest(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext value
  const buf = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
