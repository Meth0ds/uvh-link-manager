import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function sign(payload: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  // base64url keeps the payload free of the "." delimiter (payloads can carry
  // hostnames with dots), so split/join is unambiguous.
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const mac = createHmac("sha256", config.appSecret).update(`${body}.${exp}`).digest("base64url");
  return `${body}.${exp}.${mac}`;
}

export function verify<T>(token: string, parse: (payload: string) => T): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [body, expStr, mac] = parts as [string, string, string];
  if (Number(expStr) < Date.now()) return null;
  const expected = createHmac("sha256", config.appSecret).update(`${body}.${expStr}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
