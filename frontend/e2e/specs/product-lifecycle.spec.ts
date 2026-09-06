import { expect, test } from "@playwright/test";
import { registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { createWorkspaceFromBrowser } from "../support/workspace";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("workspace y enlace recorren creación, edición, pausa, papelera y restauración", async ({ page }) => {
  test.setTimeout(600_000);
  await registerVerifyAndLogin(page, "link-lifecycle");

  await createWorkspaceFromBrowser(page, "Operaciones E2E");

  await page.goto("/app/links");
  await expect(page.getByRole("heading", { name: "Enlaces" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Nuevo enlace" }).click();

  const alias = `e2e-${Date.now()}`;
  const originalDestination = "https://example.com/original";
  const updatedDestination = "https://example.com/actualizado";
  await page.getByLabel("URL de destino").fill(originalDestination);
  await page.getByLabel("Alias (opcional)").fill(alias);
  // The availability hint is deliberately best-effort. The authoritative
  // uniqueness check is the transactional create endpoint asserted below.
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/links") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Crear enlace", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole("heading", { name: new RegExp(alias) })).toBeVisible();

  await page.getByRole("button", { name: "Más acciones" }).click();
  const pauseResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+\/state$/.test(response.url()));
  await page.getByRole("menuitem", { name: "Pausar" }).click();
  expect((await pauseResponse).status()).toBe(200);
  await expect(page.locator(".state-chip")).toContainText("paused");

  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("URL de destino").fill(updatedDestination);
  const updateResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+$/.test(response.url()) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await updateResponse).status()).toBe(200);
  await expect(page.getByText(updatedDestination, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  const deleteResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+$/.test(response.url()) && response.request().method() === "DELETE");
  // Destructive confirmations deliberately expose the stronger alertdialog
  // role so assistive technology announces their urgency.
  await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar enlace" }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/links$/);

  await page.goto("/app/links/trash");
  const deletedRow = page.locator(".trash-row").filter({ hasText: alias });
  await expect(deletedRow).toBeVisible();
  const restoreResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+\/restore$/.test(response.url()));
  await deletedRow.getByRole("button", { name: "Restaurar" }).click();
  expect((await restoreResponse).status()).toBe(200);
  await expect(deletedRow).toHaveCount(0);

  await page.goto("/app/links");
  await expect(page.getByText(updatedDestination, { exact: true })).toBeVisible();
  // Restore recomputes a safe runtime state instead of reviving a stale pause.
  // A non-expired, non-scheduled link must therefore return as active.
  await expect(page.getByText("Activo", { exact: true })).toBeVisible();
});
