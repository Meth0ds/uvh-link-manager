import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { E2E_PASSWORD, loginFromBrowser, logoutFromBrowser, registerFromBrowser } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";

/**
 * Regresión anti-enumeración sobre la pila real: ninguna superficie pública
 * puede revelar qué guarda una dirección —libre, ocupada por un registro sin
 * verificar o cuenta verificada— ni por status, ni por bytes, ni por flujo
 * visible. La suite de backend fija el contrato JSON exacto; este archivo
 * falla si un cambio de UI o de API vuelve a abrir un oráculo de existencia, y
 * fija la semántica honesta de la pre-ocupación: el último registro pendiente
 * desde el mismo buzón gana y su dueño lo completa con el enlace más reciente.
 */

const ATTACKER_PASSWORD = "Copper-Drift_Lantern-913!";
const CSRF_TOKEN = "anti-enumeration-csrf";
const CAPTCHA_TOKEN = "uvh-e2e-pass-anti-enumeration";

function api(request: APIRequestContext, path: string, data: Record<string, unknown>): Promise<APIResponse> {
  return request.post(path, {
    data,
    headers: { "X-CSRF-Token": CSRF_TOKEN, Cookie: `uvh_csrf=${CSRF_TOKEN}` },
  });
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

async function verifyThroughMail(request: APIRequestContext, email: string): Promise<void> {
  const token = new URL(await readMailLink(email, "verification")).hash.replace("#token=", "");
  expect((await api(request, "/api/v1/auth/verify-email", { token })).status()).toBe(200);
}

test("el registro contesta igual sea libre, ocupada o verificada la dirección", async ({ request }) => {
  const stamp = Date.now();
  const parkedEmail = `parked-${stamp}@example.test`;
  const verifiedEmail = `verified-${stamp}@example.test`;

  // Fijaciones: una dirección ocupada por un registro sin verificar…
  expect((await api(request, "/api/v1/auth/register", registerBody(parkedEmail, ATTACKER_PASSWORD))).status()).toBe(201);
  // …y una cuenta verificada de verdad.
  expect((await api(request, "/api/v1/auth/register", registerBody(verifiedEmail, E2E_PASSWORD))).status()).toBe(201);
  await verifyThroughMail(request, verifiedEmail);

  // Los tres destinos deben contestar con el mismo status y los mismos bytes.
  const answers: APIResponse[] = [];
  for (const email of [`libre-${stamp}@example.test`, parkedEmail, verifiedEmail]) {
    answers.push(await api(request, "/api/v1/auth/register", registerBody(email, E2E_PASSWORD)));
  }
  await expectSameAnswers(answers, 201);

  // El oráculo histórico (409 vs 200) debe seguir cerrado para el registro.
  const mover = `mover-${stamp}@example.test`;
  expect((await api(request, "/api/v1/auth/register", registerBody(mover, ATTACKER_PASSWORD))).status()).toBe(201);
  const corrections: APIResponse[] = [];
  for (const newEmail of [verifiedEmail, `mudado-${stamp}@example.test`]) {
    corrections.push(
      await api(request, "/api/v1/auth/change-registration-email", {
        currentEmail: mover,
        newEmail,
        password: ATTACKER_PASSWORD,
        captchaToken: CAPTCHA_TOKEN,
      }),
    );
  }
  await expectSameAnswers(corrections, 200);
});

test("el login y el reenvío de verificación no revelan si la cuenta existe", async ({ request }) => {
  const stamp = Date.now();
  const existing = `existente-${stamp}@example.test`;
  const unknown = `ignorado-${stamp}@example.test`;
  expect((await api(request, "/api/v1/auth/register", registerBody(existing, E2E_PASSWORD))).status()).toBe(201);
  await verifyThroughMail(request, existing);

  // Dirección inexistente y contraseña equivocada contestan exactamente igual…
  await expectSameAnswers(
    [
      await api(request, "/api/v1/auth/login", { email: unknown, password: E2E_PASSWORD, captchaToken: CAPTCHA_TOKEN }),
      await api(request, "/api/v1/auth/login", {
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
      await api(request, "/api/v1/auth/resend-verification", { email: unknown, captchaToken: CAPTCHA_TOKEN }),
      await api(request, "/api/v1/auth/resend-verification", { email: existing, captchaToken: CAPTCHA_TOKEN }),
    ],
    200,
  );
});

test("la pre-ocupación termina con el relevo del buzón, sin atajos para el que la montó", async ({ page }) => {
  await installHCaptchaBridge(page);
  const email = `relevo-${Date.now()}@example.test`;

  // Un registro aparcado sobre el email de otra persona, por el formulario real…
  const parkedAnswer = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email, "Atacante E2E", ATTACKER_PASSWORD);
  const parked = await parkedAnswer;
  expect(parked.status()).toBe(201);
  const parkedBytes = await parked.text();

  // …y el dueño del buzón vive el flujo idéntico y recibe la respuesta idéntica.
  const ownerAnswer = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await registerFromBrowser(page, email, "Victima E2E");
  const owner = await ownerAnswer;
  expect(owner.status()).toBe(201);
  expect(await owner.text()).toBe(parkedBytes);

  // El enlace más reciente es el del dueño y completa el registro.
  await page.goto(await readMailLink(email, "verification"));
  await page.getByRole("button", { name: "Confirmar mi email" }).click();
  await expect(page.getByRole("heading", { name: "Email verificado" })).toBeVisible();

  await loginFromBrowser(page, email);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);

  // Las credenciales sustituidas ya no abren la cuenta.
  await logoutFromBrowser(page);
  await loginFromBrowser(page, email, ATTACKER_PASSWORD);
  await expect(page.getByRole("alert")).toContainText("Credenciales incorrectas");
});
