import { expect, test, type APIRequestContext, type APIResponse, type Page } from "../fixtures";

import { E2E_PASSWORD, loginFromBrowser, logoutFromBrowser, registerFromBrowser } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

/**
 * Regresión anti-enumeración sobre la pila real: ninguna superficie pública
 * puede revelar qué guarda una dirección —libre, ocupada por un registro sin
 * verificar o cuenta verificada— ni por status, ni por bytes, ni por flujo
 * visible. La suite de backend fija el contrato JSON exacto; este archivo
 * falla si un cambio de UI o de API vuelve a abrir un oráculo de existencia, y
 * fija la semántica honesta de la pre-ocupación: una inscripción sin verificar no
 * posee la dirección, no la sustituye un registro posterior, y quien completa el
 * registro es quien abre el buzón, eligiendo allí su contraseña definitiva.
 */

const ATTACKER_PASSWORD = "Copper-Drift_Lantern-913!";
const CAPTCHA_TOKEN = "uvh-e2e-pass-anti-enumeration";

/**
 * Opens the API the way the browser does: the CSRF token is the one the
 * deployment hands out, and the cookie carrying it stays in this context's jar.
 *
 * Writing the `Cookie` header by hand is what this helper must not do. A header
 * replaces the jar instead of adding to it, so the edit secret that `register`
 * sealed for this very browser would never travel back, and the correction would
 * be refused as unauthorised — a `403` about the harness, not about the contract
 * this file exists to pin down.
 */
async function openApi(request: APIRequestContext): Promise<string> {
  const bootstrap = await request.get("/api/v1/csrf");
  expect(bootstrap.status()).toBe(200);
  const { csrfToken } = (await bootstrap.json()) as { csrfToken?: unknown };
  expect(csrfToken, "the deployment did not hand out a CSRF token").toBeTruthy();

  return String(csrfToken);
}

function api(request: APIRequestContext, csrf: string, path: string, data: Record<string, unknown>): Promise<APIResponse> {
  return request.post(path, { data, headers: { "X-CSRF-Token": csrf } });
}

function registerBody(email: string, password: string): Record<string, unknown> {
  return {
    name: "Persona E2E",
    email,
    password,
    captchaToken: CAPTCHA_TOKEN,
    acceptTerms: true,
    termsVersion: "2026-08-30",
    privacyVersion: "2026-08-30",
  };
}

/** Mismo status y mismos bytes ocurra lo que ocurra con la dirección. */
async function expectSameAnswers(responses: APIResponse[], status: number): Promise<void> {
  const bodies = new Set<string>();
  for (const response of responses) {
    expect(response.status()).toBe(status);
    bodies.add(await response.text());
  }
  expect(bodies.size).toBe(1);
}

async function verifyThroughMail(request: APIRequestContext, csrf: string, email: string): Promise<void> {
  const token = new URL(await readMailLink(email, "verification")).hash.replace("#token=", "");
  // Activation establishes the definitive password, typed by the mailbox
  // owner alongside the bearer.
  expect((await api(request, csrf, "/api/v1/auth/verify-email", { token, password: E2E_PASSWORD })).status()).toBe(200);
}

/**
 * Pins the answer to the next registration, bytes included.
 *
 * The body is read inside the listener, while the response still exists. The
 * registration screen navigates as soon as it has an answer, and a body asked
 * for after that navigation is gone for good — "No data found for resource with
 * given identifier" — so writing this as `(await answer).text()` races the
 * screen. The bytes are the whole point of this file, so they are read here.
 */
async function captureRegistration(page: Page): Promise<{ status: number; body: string }> {
  let captured: { status: number; body: string } | null = null;
  await page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/v1/auth/register")) return false;
    captured = { status: response.status(), body: await response.text() };

    return true;
  });

  if (captured === null) {
    throw new Error("the registration answer was not captured");
  }

  return captured;
}

test("el registro contesta igual sea libre, ocupada o verificada la dirección", async ({ request }) => {
  const csrf = await openApi(request);
  const stamp = Date.now();
  const parkedEmail = `parked-${stamp}@example.test`;
  const verifiedEmail = `verified-${stamp}@example.test`;

  // Fijaciones: una dirección ocupada por un registro sin verificar…
  expect((await api(request, csrf, "/api/v1/auth/register", registerBody(parkedEmail, ATTACKER_PASSWORD))).status()).toBe(201);
  // …y una cuenta verificada de verdad.
  expect((await api(request, csrf, "/api/v1/auth/register", registerBody(verifiedEmail, E2E_PASSWORD))).status()).toBe(201);
  await verifyThroughMail(request, csrf, verifiedEmail);

  // Los tres destinos deben contestar con el mismo status y los mismos bytes.
  const answers: APIResponse[] = [];
  for (const email of [`libre-${stamp}@example.test`, parkedEmail, verifiedEmail]) {
    answers.push(await api(request, csrf, "/api/v1/auth/register", registerBody(email, E2E_PASSWORD)));
  }
  await expectSameAnswers(answers, 201);

  // El oráculo histórico (409 vs 200) debe seguir cerrado para el registro, y
  // también para la corrección de dirección: la autoridad es la cookie que el
  // propio registro emitió a este contexto, no la contraseña propuesta.
  const mover = `mover-${stamp}@example.test`;
  expect((await api(request, csrf, "/api/v1/auth/register", registerBody(mover, ATTACKER_PASSWORD))).status()).toBe(201);
  const corrections: APIResponse[] = [];
  for (const newEmail of [verifiedEmail, `mudado-${stamp}@example.test`]) {
    corrections.push(
      await api(request, csrf, "/api/v1/auth/change-registration-email", {
        currentEmail: mover,
        newEmail,
        captchaToken: CAPTCHA_TOKEN,
      }),
    );
  }
  await expectSameAnswers(corrections, 200);
});

test("el login y el reenvío de verificación no revelan si la cuenta existe", async ({ request }) => {
  const csrf = await openApi(request);
  const stamp = Date.now();
  const existing = `existente-${stamp}@example.test`;
  const unknown = `ignorado-${stamp}@example.test`;
  expect((await api(request, csrf, "/api/v1/auth/register", registerBody(existing, E2E_PASSWORD))).status()).toBe(201);
  await verifyThroughMail(request, csrf, existing);

  // Dirección inexistente y contraseña equivocada contestan exactamente igual…
  await expectSameAnswers(
    [
      await api(request, csrf, "/api/v1/auth/login", { email: unknown, password: E2E_PASSWORD, captchaToken: CAPTCHA_TOKEN }),
      await api(request, csrf, "/api/v1/auth/login", {
        email: existing,
        password: ATTACKER_PASSWORD,
        captchaToken: CAPTCHA_TOKEN,
      }),
    ],
    401,
  );

  // …y las superficies públicas de recuperación también.
  await expectSameAnswers(
    [
      await api(request, csrf, "/api/v1/auth/resend-verification", { email: unknown, captchaToken: CAPTCHA_TOKEN }),
      await api(request, csrf, "/api/v1/auth/resend-verification", { email: existing, captchaToken: CAPTCHA_TOKEN }),
    ],
    200,
  );
});

test("la pre-ocupación termina en el buzón del dueño, sin atajos para el que la montó", async ({ page }) => {
  await installHCaptchaBridge(page);
  const email = `relevo-${Date.now()}@example.test`;

  // Un registro aparcado sobre el email de otra persona, por el formulario real…
  const parkedAnswer = captureRegistration(page);
  await registerFromBrowser(page, email, "Atacante E2E", ATTACKER_PASSWORD);
  const parked = await parkedAnswer;
  expect(parked.status).toBe(201);

  // …y el dueño del buzón vive el flujo idéntico y recibe la respuesta idéntica.
  const ownerAnswer = captureRegistration(page);
  await registerFromBrowser(page, email, "Victima E2E");
  const owner = await ownerAnswer;
  expect(owner.status).toBe(201);
  expect(owner.body).toBe(parked.body);

  // Un solo registro existe y su bearer está en el buzón del dueño: quien lo
  // abre completa la cuenta con la contraseña que elige ahí, así que la
  // propuesta del atacante —que el segundo registro ni siquiera reescribió—
  // nunca llega a ser credencial activa.
  await page.goto(await readMailLink(email, "verification"));
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  await expect(page.getByRole("heading", { name: "Email verificado" })).toBeVisible();

  await loginFromBrowser(page, email);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);

  // Las credenciales sustituidas ya no abren la cuenta.
  await logoutFromBrowser(page);
  await loginFromBrowser(page, email, ATTACKER_PASSWORD);
  await expect(page.getByRole("alert")).toContainText("Credenciales incorrectas");
});
