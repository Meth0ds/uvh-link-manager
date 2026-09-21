/**
 * The deterministic providers: mail, DNS and the control surface the drills
 * use to make a provider fail on purpose.
 *
 * Reading what a provider actually received is what lets a scenario assert
 * reception rather than transport acceptance, so it lives here, together with
 * the bearer matching that ties a delivered message to the row that asked for
 * it.
 */

import crypto from "node:crypto";
import { until } from "./expect.mjs";
import { control } from "./topology.mjs";

export const fixtureSecret = "fixture-secret-0123456789";
export const hookUrl = "http://11.0.0.10:8080/hook";
export async function fixture(base, requestPath, { method = "GET", json } = {}) {
  const response = await fetch(base + requestPath, {
    method,
    headers: json === undefined ? {} : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const raw = await response.text();
  const body = (() => {
    try {
      return raw === "" ? null : JSON.parse(raw);
    } catch {
      return raw;
    }
  })();
  return { status: response.status, body, raw };
}

export const setState = (base, json) => fixture(base, "/__state", { method: "POST", json });
function readableMessage(raw) {
  const unfolded = raw.replace(/=\r?\n/g, "");
  let text = unfolded;
  if (/Content-Transfer-Encoding:\s*base64/i.test(unfolded)) {
    text = unfolded.replace(/[A-Za-z0-9+/=\r\n]{60,}/g, (chunk) => {
      try {
        return Buffer.from(chunk.replace(/\s/g, ""), "base64").toString("utf8");
      } catch {
        return chunk;
      }
    });
  }
  text = text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return text;
}

/**
 * Extract a bearer from a message. Both the decoded and the raw form are
 * tried: a body that is not quoted-printable can contain a literal `=a3`, and
 * the transport is free to choose the encoding.
 */
/** First 12 hex characters of the stored hash for a bearer. */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function tokenFromUrl(raw) {
  // Every bearer in this suite is a 32-byte base64url value (43 characters).
  // Prefer the exact length so a quoted-printable artefact cannot be glued to
  // the front of the token; fall back to a loose match for diagnostics.
  const patterns = [
    /[#?&]token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/,
    /[#?&]token=([A-Za-z0-9_-]{20,})/,
  ];
  const candidates = [readableMessage(raw), raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=")];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
}

/** Every message the SMTP provider accepted for a recipient, oldest first. */
export async function messagesFor(email) {
  const listing = await fixture(control.mail, "/__files?dir=messages");
  const files = Array.isArray(listing.body?.files) ? listing.body.files : [];
  const matches = [];
  for (const name of files) {
    const file = await fixture(control.mail, `/__file?name=messages/${encodeURIComponent(name)}`);
    if (file.raw.toLowerCase().includes(email.toLowerCase())) {
      matches.push({ name, raw: file.raw });
    }
  }
  return matches;
}

/** The one accepted message matching a predicate, or undefined while absent. */
export async function messageMatching(email, predicate) {
  const matches = await messagesFor(email);
  return matches.find((message) => predicate(readableMessage(message.raw), message));
}

export async function attemptsFor(email) {
  const file = await fixture(control.mail, "/__file?name=attempts.jsonl");
  if (typeof file.raw !== "string" || file.raw.trim() === "") return [];
  return file.raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((entry) => Array.isArray(entry.rcpt) && entry.rcpt.some((value) => String(value).toLowerCase() === email.toLowerCase()));
}

export async function bearerMatching(email, hash) {
  return until("a bearer reaches the provider", async () => {
    for (const message of await messagesFor(email)) {
      const token = tokenFromUrl(message.raw);
      if (token && hashToken(token) === hash) return token;
    }
    return undefined;
  }, { deadlineMs: 45_000 }).catch(() => null);
}
