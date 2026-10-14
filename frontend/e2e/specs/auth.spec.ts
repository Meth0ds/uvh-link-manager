import { expect, test } from "../fixtures";
import { E2E_PASSWORD, loginFromBrowser, registerFromBrowser } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("registro y verificación abren sesión sin volver a introducir credenciales", async ({ page }) => {
  const email = `registration-${Date.now()}@example.test`;
  const registrationRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email);
  expect((await registrationRequest).postDataJSON()).toEqual({ email, captchaToken: expect.any(String), website: "" });

  const verificationUrl = await readMailLink(email, "verification");
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
  await expect(page.getByRole("heading", { name: "Completa tu registro" })).toBeVisible();
  await page.getByLabel("Nombre completo").fill("Persona E2E");
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(E2E_PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta creada correctamente" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/verify-email$/);
  await page.getByRole("link", { name: "Ir al panel" }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
});

test("un registro pendiente no abre sesión ni reto MFA y el reenvío vive en una entrada propia", async ({ page }) => {
  const email = `unverified-${Date.now()}@example.test`;
  await registerFromBrowser(page, email);
  await loginFromBrowser(page, email);

  // Un registro pendiente no es una cuenta: el login desde el navegador que lo
  // creó no da sesión ni reta MFA, y el servidor sólo abre la pantalla de
  // verificación, su señal de ciclo de vida cerrada. La frontera
  // anti-enumeración es el secreto de edición del registro solo —una
  // capability de ese navegador—: la contraseña no forma parte de ella y su
  // resultado ni se consulta antes de revelar. Sin secreto (o con uno
  // inválido) la respuesta es siempre la genérica «Credenciales incorrectas»;
  // esa frontera la fija el contrato del backend (ApiParityTest), no este spec.
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Confirma tu email" })).toBeVisible();

  // El reenvío vive en una entrada propia de esa pantalla: nunca se dispara
  // solo, se solicita a mano y el resultado se anuncia sin más.
  await page.getByRole("button", { name: "Reenviar enlace" }).click();
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
  await expect(page.getByRole("heading", { name: "Confirma tu email" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?mode=register$/);
});

test("el enlace del hero se recupera al activar desde otro navegador", async ({ page, browser }) => {
  const email = `hero-registration-${Date.now()}@example.test`;
  const destination = "https://example.org/hero-registration";
  await page.goto("/");
  await page.locator("#hero-url").fill(destination);
  await page.locator(".hero-form").getByRole("button", { name: "Preparar enlace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crea tu cuenta en UVH" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar enlace de registro" }).click();
  await expect(page.getByRole("heading", { name: "Confirma tu email" })).toBeVisible();
  const verificationUrl = await readMailLink(email, "verification");
  const otherDevice = await browser.newContext();
  try {
    const mobile = await otherDevice.newPage();
    await mobile.goto(verificationUrl);
    await mobile.getByLabel("Nombre completo").fill("Persona Hero");
    await mobile.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
    await mobile.getByLabel("Repite la contraseña").fill(E2E_PASSWORD);
    await mobile.getByRole("checkbox").check();
    await mobile.getByRole("button", { name: "Crear mi cuenta" }).click();
    await expect(mobile.getByRole("heading", { name: "Cuenta creada correctamente" })).toBeVisible();
    await expect(mobile).toHaveURL(/\/auth\/verify-email$/);
    await mobile.getByRole("link", { name: "Continuar con mi enlace" }).click();
    await expect(mobile).toHaveURL(/\/app\/links$/);
    await expect(mobile.getByRole("dialog")).toBeVisible();
    await expect(mobile.getByRole("dialog").getByLabel("URL de destino", { exact: true })).toHaveValue(destination);
  } finally {
    await otherDevice.close();
  }
});
