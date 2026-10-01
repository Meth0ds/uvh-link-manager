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
  // El nombre del workspace vive en varios sitios (resumen del sidenav, picker
  // de la barra superior, encabezados de página) y el resumen se oculta a
  // propósito en ventanas bajas para que la navegación siga alcanzable. La
  // aserción se ancla al picker de la barra superior: único, siempre visible y
  // es el control que dice cuál es el workspace actual.
  const picker = page.getByRole("button", { name: "Cambiar workspace" });
  await expect(picker.getByText(workspaceName, { exact: true })).toBeVisible();
  return workspaceName;
}
