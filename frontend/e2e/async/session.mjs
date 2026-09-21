/**
 * Accounts and HTTP: how the suite becomes a user and speaks to the API.
 *
 * The browser's session and CSRF cookies are reproduced exactly; the fixtures
 * that answer captcha and mail are someone else's concern.
 */

import crypto from "node:crypto";
import { backend } from "./topology.mjs";

export const password = "Glass-Falcon_Orbit-742!";
export const csrfToken = "uvh-async-e2e-csrf";
export async function api(method, requestPath, { json, session, workspaceId, redirect = "follow", headers: extra = {} } = {}) {
  const headers = {
    Accept: "application/json",
    "X-CSRF-Token": csrfToken,
    Cookie: `uvh_csrf=${csrfToken}${session ? `; uvh_async_session=${session}` : ""}`,
    ...extra,
  };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (workspaceId) headers["X-Workspace-Id"] = String(workspaceId);
  const response = await fetch(backend + requestPath, {
    method,
    headers,
    redirect,
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
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const sessionCookie = cookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("uvh_async_session="));
  return {
    status: response.status,
    body,
    raw,
    headers: response.headers,
    session: sessionCookie ? sessionCookie.split("=").slice(1).join("=") : undefined,
  };
}

export function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

export async function register(email, name = "Persona Async") {
  return api("POST", "/api/v1/auth/register", {
    json: {
      name,
      email,
      password,
      captchaToken: `uvh-e2e-pass-${crypto.randomBytes(8).toString("hex")}`,
      acceptTerms: true,
      termsVersion: "2026-08-30",
      privacyVersion: "2026-08-30",
    },
  });
}

export async function login(email) {
  const response = await api("POST", "/api/v1/auth/login", {
    json: { email, password, captchaToken: `uvh-e2e-pass-${crypto.randomBytes(8).toString("hex")}` },
  });
  if (response.status !== 200 || !response.session) {
    throw new Error(`login failed: ${response.status} ${response.raw.slice(0, 200)}`);
  }
  return response.session;
}

export async function workspaces(session) {
  const response = await api("GET", "/api/v1/workspaces", { session });
  const list = response.body?.workspaces ?? [];
  if (list.length === 0) throw new Error("the registered account has no workspace");
  return list;
}
