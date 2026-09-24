import { expect, test } from "../fixtures";
import { E2E_PASSWORD, loginFromBrowser, registerFromBrowser } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("registro, verificación por email y login crean una sesión real", async ({ page }) => {
  const email = `registration-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);

  const verificationUrl = await readMailLink(email, "verification");
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
  await page.getByLabel("Nombre completo").fill("Persona E2E");
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(E2E_PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  await expect(page.getByRole("heading", { name: "Email verificado" })).toBeVisible();

  await page.getByRole("link", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuelve a tus enlaces." })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar en mi panel" }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
});

test("un registro pendiente no abre sesión ni reto MFA y el reenvío vive en una entrada propia", async ({ page }) => {
  const email = `unverified-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);
  await loginFromBrowser(page, email);

  // Un registro pendiente no es una cuenta: el login contesta como unas
  // credenciales incorrectas —sin sesión y sin reto MFA— y con ello NO revela
  // si esa dirección sigue pendiente (señal de ciclo de vida cerrada).
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("alert")).toContainText("Credenciales incorrectas");
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toHaveCount(0);

  // La vuelta al buzón es una entrada pública del panel de acceso, siempre
  // disponible y sin depender de ninguna señal del servidor.
  await expect(page.getByRole("button", { name: "Reenviar verificación" })).toBeVisible();
  await page.getByRole("button", { name: "Reenviar verificación" }).click();
  await expect(page.getByText("recibirás un nuevo correo en breve")).toBeVisible();
});

test("registro duplicado conserva la respuesta anti-enumeración", async ({ page }) => {
  const email = `duplicate-${Date.now()}@example.test`;
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email);
  expect((await firstResponse).status()).toBe(201);

  // The UI must not reveal whether the address already existed: the observable
  // status and confirmation screen remain identical to the first registration.
  // The backend suite separately asserts the exact JSON contract.
  const duplicateResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email);
  const response = await duplicateResponse;
  expect(response.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?mode=register$/);
});
