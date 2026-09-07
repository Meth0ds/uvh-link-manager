import type { Page } from "@playwright/test";

export interface BrowserApiResult {
  status: number;
  body: unknown;
}

/** Read the workspace selected by the production client without seeding auth state. */
export async function selectedWorkspaceId(page: Page): Promise<number> {
  const raw = await page.evaluate(() => window.localStorage.getItem("uvh.workspaceId"));
  if (!raw || !/^[1-9][0-9]*$/u.test(raw)) throw new Error("No valid workspace is selected in the E2E browser.");
  return Number(raw);
}

/**
 * Send an authenticated API request through the browser origin. Keeping the
 * real session and double-submit CSRF cookies in the browser avoids exporting
 * either credential to the Node test process.
 */
export async function browserApi(
  page: Page,
  workspaceId: number,
  method: "GET" | "POST" | "DELETE",
  requestPath: string,
  body?: unknown,
): Promise<BrowserApiResult> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new Error("Invalid E2E workspace ID.");
  if (!requestPath.startsWith("/api/v1/")) throw new Error("E2E API requests must stay under /api/v1/.");

  return page.evaluate(async ({ workspaceId: id, method: verb, requestPath: url, body: payload }) => {
    const csrfCookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("__Host-uvh_csrf=") || part.startsWith("uvh_csrf="));
    const csrf = csrfCookie ? decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf("=") + 1)) : "";
    if (!csrf) throw new Error("The authenticated E2E browser has no CSRF cookie.");

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-CSRF-Token": csrf,
      "X-Workspace-Id": String(id),
    };
    if (payload !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(url, {
      method: verb,
      credentials: "include",
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  }, { workspaceId, method, requestPath, body });
}
