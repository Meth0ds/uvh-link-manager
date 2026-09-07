import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { browserApi, selectedWorkspaceId, type BrowserApiResult } from "../support/api";
import { E2E_PASSWORD, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { ageE2ETrash, runE2EHousekeeping } from "../support/trash";
import { createWorkspaceFromBrowser } from "../support/workspace";

interface RaceLink {
  id: number;
  alias: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function linkFromCreate(result: BrowserApiResult, alias: string): RaceLink {
  expect(result.status).toBe(201);
  if (!isRecord(result.body) || !isRecord(result.body["link"])) throw new Error("Create response has no link envelope.");
  const id = result.body["link"]["id"];
  if (!Number.isSafeInteger(id) || (id as number) < 1) throw new Error("Create response has no valid link ID.");
  return { id: id as number, alias };
}

function clickCountFromShow(result: BrowserApiResult): number {
  expect(result.status).toBe(200);
  if (!isRecord(result.body) || !isRecord(result.body["link"])) throw new Error("Show response has no link envelope.");
  const clickCount = result.body["link"]["clickCount"];
  if (!Number.isSafeInteger(clickCount) || (clickCount as number) < 0) throw new Error("Show response has no valid click count.");
  return clickCount as number;
}

async function createLink(page: Page, workspaceId: number, alias: string): Promise<RaceLink> {
  return linkFromCreate(await browserApi(page, workspaceId, "POST", "/api/v1/links", {
    alias,
    destination: "https://example.com/race-target",
  }), alias);
}

async function trashLink(page: Page, workspaceId: number, link: RaceLink): Promise<void> {
  expect((await browserApi(page, workspaceId, "DELETE", `/api/v1/links/${link.id}`)).status).toBe(200);
}

async function prepareTrashedLinks(
  page: Page,
  workspaceId: number,
  prefix: string,
  count: number,
): Promise<RaceLink[]> {
  const links: RaceLink[] = [];
  for (let index = 0; index < count; index += 1) {
    const link = await createLink(page, workspaceId, `${prefix}-${index}`);
    await trashLink(page, workspaceId, link);
    links.push(link);
  }
  return links;
}

async function publicClick(request: APIRequestContext, alias: string): Promise<number> {
  const response = await request.get(`http://127.0.0.1:8010/r/${alias}`, {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  return response.status();
}

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("Papelera serializa clic y restore sin perder ni duplicar el contador", async ({ page, request }) => {
  test.setTimeout(480_000);
  await registerVerifyAndLogin(page, "trash-click-restore-race");
  await createWorkspaceFromBrowser(page, "Carrera clic restore E2E");
  const workspaceId = await selectedWorkspaceId(page);
  const prefix = `click-restore-${Date.now()}`;
  const links = await prepareTrashedLinks(page, workspaceId, prefix, 4);

  for (const link of links) {
    // These hit independent PHP workers. A click may observe the row before or
    // after restore, but the redirect's locked recheck must make both outcomes exact.
    const [restore, clickStatus] = await Promise.all([
      browserApi(page, workspaceId, "POST", `/api/v1/links/${link.id}/restore`),
      publicClick(request, link.alias),
    ]);
    expect(restore.status).toBe(200);
    expect([302, 404]).toContain(clickStatus);

    const shown = await browserApi(page, workspaceId, "GET", `/api/v1/links/${link.id}`);
    expect(clickCountFromShow(shown)).toBe(clickStatus === 302 ? 1 : 0);
  }
});

test("Papelera resuelve restore y purge concurrentes con un único ganador", async ({ page }) => {
  test.setTimeout(480_000);
  await registerVerifyAndLogin(page, "trash-restore-purge-race");
  await createWorkspaceFromBrowser(page, "Carrera restore purge E2E");
  const workspaceId = await selectedWorkspaceId(page);
  const prefix = `restore-purge-${Date.now()}`;
  const links = await prepareTrashedLinks(page, workspaceId, prefix, 3);

  for (const link of links) {
    const [restore, purge] = await Promise.all([
      browserApi(page, workspaceId, "POST", `/api/v1/links/${link.id}/restore`),
      browserApi(page, workspaceId, "POST", `/api/v1/links/${link.id}/purge`, {
        password: E2E_PASSWORD,
        factorCode: "",
        confirmation: `ELIMINAR ${link.alias}`,
      }),
    ]);
    expect([restore.status, purge.status].sort((a, b) => a - b)).toEqual([200, 404]);

    const final = await browserApi(page, workspaceId, "GET", `/api/v1/links/${link.id}`);
    expect(final.status).toBe(restore.status === 200 ? 200 : 404);
  }
});

test("Papelera conserva estados terminales al competir restore y housekeeping", async ({ page }) => {
  test.setTimeout(600_000);
  await registerVerifyAndLogin(page, "trash-restore-housekeeping-race");
  await createWorkspaceFromBrowser(page, "Carrera restore housekeeping E2E");
  const workspaceId = await selectedWorkspaceId(page);
  const prefix = `restore-housekeeping-${Date.now()}`;
  const links = await prepareTrashedLinks(page, workspaceId, prefix, 8);
  await ageE2ETrash(workspaceId, prefix, links.length);

  // Staggering requests across the scheduler startup window exercises both
  // lock orders without assuming which process wins on a particular machine.
  const restorePromises = links.map(async (link, index) => {
    await new Promise((resolve) => setTimeout(resolve, index * 75));
    return browserApi(page, workspaceId, "POST", `/api/v1/links/${link.id}/restore`);
  });
  const [, restoreResults] = await Promise.all([
    runE2EHousekeeping(),
    Promise.all(restorePromises),
  ]);

  for (const [index, restore] of restoreResults.entries()) {
    expect([200, 404]).toContain(restore.status);
    const final = await browserApi(page, workspaceId, "GET", `/api/v1/links/${links[index].id}`);
    expect(final.status).toBe(restore.status === 200 ? 200 : 404);
  }
  const trash = await browserApi(page, workspaceId, "GET", "/api/v1/links/trash?page=1&perPage=20");
  expect(trash.status).toBe(200);
  if (!isRecord(trash.body) || trash.body["total"] !== 0) throw new Error("The race left links stranded in trash.");
});
