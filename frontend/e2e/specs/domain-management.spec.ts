import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "../fixtures";
import { registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { browserApi } from "../support/api";

const execFileAsync = promisify(execFile);

for (const width of [390, 1440]) for (const colorScheme of ["light", "dark"] as const) {
  test(`Dominios: guía y reasignación conservan papelera (${width}, ${colorScheme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await installHCaptchaBridge(page);
    const { email } = await registerVerifyAndLogin(page, `domain-e2e-${width}-${colorScheme}`);
    await page.goto("/app/domains");
    const hostname = `go.${Date.now()}.example.test`;
    await page.getByLabel("Dominio", { exact: true }).fill(hostname);
    const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/domains") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Añadir dominio" }).click();
    expect((await createdResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/app\/domains\/\d+$/);
    const sourceId = Number(new URL(page.url()).pathname.split("/").at(-1));
    await expect(page.getByRole("heading", { name: "Conecta tu dominio" })).toBeVisible();
    await page.getByRole("button", { name: "Cloudflare", exact: true }).click();
    await expect(page.getByText("DNS only", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Prepara la conexión" })).toBeVisible();

    const { stdout } = await execFileAsync("docker", ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "exec", "-T", "app", "php", "tests/E2E/prepare-domain-management.php", email, String(sourceId)], {
      cwd: path.resolve(__dirname, "../../.."), timeout: 30_000,
    });
    const fixture = JSON.parse(stdout.trim()) as { sourceId: number; targetId: number; targetDomain: string; workspaceId: number; live: number; trash: number };
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tu dominio está disponible" })).toBeVisible();
    await page.getByRole("button", { name: `Eliminar ${hostname}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Eliminar dominio", exact: true });
    await expect(dialog.getByText("Quedan 2 enlaces asociados.", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Revisar y reasignar" }).click();
    await dialog.getByRole("checkbox", { name: `Seleccionar live-${fixture.sourceId}`, exact: true }).check();
    await dialog.getByRole("tab", { name: "Papelera", exact: true }).click();
    await dialog.getByRole("checkbox", { name: `Seleccionar trash-${fixture.sourceId}`, exact: true }).check();
    await dialog.getByRole("combobox", { name: "Dominio de destino" }).click();
    await page.getByRole("option", { name: fixture.targetDomain, exact: true }).click();
    await dialog.getByRole("button", { name: "Revisar cambios", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "3. Confirma las nuevas URL" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "3. Confirma las nuevas URL" })).toBeFocused();
    await expect(dialog.getByText("Cambiará la URL pública.", { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("app-domain-removal-dialog").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("domain-reassignment.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Confirmar reasignación de 2 enlaces", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Sin enlaces asociados" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    // A successful reassignment alone must leave the source domain in place.
    expect((await browserApi(page, fixture.workspaceId, "GET", `/api/v1/domains/${fixture.sourceId}`)).status).toBe(200);
    const trash = await browserApi(page, fixture.workspaceId, "GET", `/api/v1/links/trash?domainId=${fixture.targetId}`);
    expect(trash.status).toBe(200);
    expect((trash.body as { links: { link: { id: number; state: string }; previousState: string }[] }).links).toEqual(expect.arrayContaining([
      expect.objectContaining({ link: expect.objectContaining({ id: fixture.trash, state: "deleted" }), previousState: "paused" }),
    ]));
    await page.getByRole("button", { name: `Eliminar ${hostname}`, exact: true }).click();
    await dialog.getByRole("checkbox", { name: `Confirmo que quiero eliminar ${hostname}`, exact: true }).check();
    await dialog.getByRole("button", { name: "Eliminar dominio definitivamente", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/domains$/);
    expect((await browserApi(page, fixture.workspaceId, "GET", `/api/v1/domains/${fixture.sourceId}`)).status).toBe(404);
  });
}
