import { expect, type Page } from "@playwright/test";

/** Create a workspace through the real dialog and return its unique name. */
export async function createWorkspaceFromBrowser(page: Page, prefix: string): Promise<string> {
  const workspaceName = `${prefix} ${Date.now()}`;
  await page.getByRole("button", { name: "Crear workspace" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre del workspace").fill(workspaceName);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/workspaces") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Crear workspace", exact: true }).click();
  expect((await responsePromise).status()).toBe(201);
  await expect(page.getByText(workspaceName, { exact: true }).first()).toBeVisible();
  return workspaceName;
}
