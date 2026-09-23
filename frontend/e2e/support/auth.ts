import { expect, type Page } from "@playwright/test";
import { readMailLink } from "./mail";

export const E2E_PASSWORD = "Glass-Falcon_Orbit-742!";

export async function registerFromBrowser(
  page: Page,
  email: string,
  name = "Persona E2E",
  password = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/auth?mode=register");
  await expect(page.getByRole("heading", { name: "Crea tu cuenta en UVH" })).toBeVisible();
  await page.getByLabel("Nombre completo").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Repite la contraseña").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
}

export async function loginFromBrowser(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  await page.goto("/auth");
  // The sign-in panel is the state that owns the credential fields. Waiting for
  // its heading keeps this helper from filling a field that is still mounted
  // from the screen the caller came from, and `exact` keeps the field apart
  // from any labelled region whose name merely contains "Email".
  await expect(page.getByRole("heading", { name: "Vuelve a tus enlaces." })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar en mi panel" }).click();
}

/** Ends the browser session through the same user-visible control used in production. */
export async function logoutFromBrowser(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
}

/** Creates a unique account and crosses the real email-verification boundary. */
export async function registerVerifyAndLogin(
  page: Page,
  prefix: string,
): Promise<{ email: string; verificationUrl: string }> {
  const email = `${prefix}-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);
  const verificationUrl = await readMailLink(email, "verification");
  await page.goto(verificationUrl);
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  await expect(page.getByRole("heading", { name: "Email verificado" })).toBeVisible();
  await loginFromBrowser(page, email);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
  return { email, verificationUrl };
}
