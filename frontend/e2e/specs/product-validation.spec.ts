import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, loginFromBrowser, logoutFromBrowser, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";
import { ageE2EMfaSession, promoteE2EAdmin } from "../support/security";
import { currentTotp } from "../support/totp";
import { createWorkspaceFromBrowser } from "../support/workspace";

type InvitableRole = "admin" | "editor" | "viewer";

const ROLE_LABELS: Record<"owner" | InvitableRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Visualizador",
};

async function expectUsageProjection(page: Page, workspaceName: string, role: keyof typeof ROLE_LABELS): Promise<void> {
  const usageResponse = page.waitForResponse((response) =>
    /\/api\/v1\/workspaces\/\d+\/usage$/.test(response.url())
      && response.request().method() === "GET");
  await page.goto("/app/usage");
  const response = await usageResponse;
  expect(response.status()).toBe(200);

  // Rendering the cards is also a strict response-contract assertion:
  // UsageComponent rejects a payload whose role differs from the authenticated
  // workspace role before exposing any of these headings.
  await expect(page.getByRole("heading", { name: "Uso y límites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
  await expect(page.getByText(ROLE_LABELS[role], { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Enlaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dominios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Miembros" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();

  const editorProjection = role !== "viewer";
  const adminProjection = role === "owner" || role === "admin";
  await expect(page.getByRole("heading", { name: "Tokens API" })).toHaveCount(editorProjection ? 1 : 0);
  await expect(page.getByRole("heading", { name: "Invitaciones pendientes" })).toHaveCount(adminProjection ? 1 : 0);
  if (role === "viewer") {
    await expect(page.getByText("Puedes consultar el consumo; la gestión requiere un rol con más permisos.").first()).toBeVisible();
  }
}

async function inviteMember(page: Page, email: string, role: InvitableRole): Promise<string> {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("combobox", { name: "Rol" }).last().click();
  await page.getByRole("option", { name: role === "admin" ? "Administrador" : role === "editor" ? "Editor" : "Visor" }).click();
  const invitationResponse = page.waitForResponse((response) =>
    /\/api\/v1\/workspaces\/\d+\/invitations$/.test(response.url())
      && response.request().method() === "POST");
  await page.getByRole("button", { name: "Invitar" }).click();
  expect((await invitationResponse).status()).toBe(201);
  return readMailLink(email, "invitation");
}

async function acceptInvitation(page: Page, email: string, invitationUrl: string, workspaceName: string): Promise<void> {
  await loginFromBrowser(page, email);
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
  await page.goto(invitationUrl);
  const acceptResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/workspaces/invitations/accept")
      && response.request().method() === "POST");
  await page.getByRole("button", { name: "Aceptar invitación" }).click();
  expect((await acceptResponse).status()).toBe(200);
  await page.getByRole("link", { name: "Ir a mi panel" }).click();
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: workspaceName, exact: true }).click();
  await expect(page.getByText(workspaceName, { exact: true }).first()).toBeVisible();
}

async function expectNoWcagAAIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("uso y límites aplica la proyección real de owner, admin, editor y viewer", async ({ page }) => {
  test.setTimeout(1_200_000);

  // Every role crosses registration, email verification, login, invitation and
  // acceptance. This catches authorization drift that a seeded database would hide.
  const memberEmails: Record<InvitableRole, string> = { admin: "", editor: "", viewer: "" };
  for (const role of Object.keys(memberEmails) as InvitableRole[]) {
    memberEmails[role] = (await registerVerifyAndLogin(page, `usage-${role}`)).email;
    await logoutFromBrowser(page);
  }

  await registerVerifyAndLogin(page, "usage-owner");
  const workspaceName = await createWorkspaceFromBrowser(page, "Uso por roles E2E");
  await page.goto("/app/team");
  await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
  const invitationUrls = new Map<InvitableRole, string>();
  for (const role of Object.keys(memberEmails) as InvitableRole[]) {
    invitationUrls.set(role, await inviteMember(page, memberEmails[role], role));
  }

  await expectUsageProjection(page, workspaceName, "owner");
  await expect(page.getByText("Es una fotografía informativa")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retención de analítica" })).toBeVisible();
  await expect(page.getByText(/no acredita que la última purga se haya ejecutado/i)).toBeVisible();

  for (const role of Object.keys(memberEmails) as InvitableRole[]) {
    await logoutFromBrowser(page);
    await acceptInvitation(page, memberEmails[role], invitationUrls.get(role)!, workspaceName);
    await expectUsageProjection(page, workspaceName, role);
  }
});

test("uso y límites conserva navegación por teclado, reflow móvil y WCAG AA automatizable", async ({ page }) => {
  test.setTimeout(600_000);
  await registerVerifyAndLogin(page, "usage-accessibility");
  await createWorkspaceFromBrowser(page, "Uso accesible E2E");
  await page.goto("/app/usage");
  await expect(page.getByRole("heading", { name: "Uso y límites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retención de analítica" })).toBeVisible();

  // The first tab stop must let keyboard-only users bypass the persistent shell.
  await page.locator("body").press("Tab");
  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel-content")).toBeFocused();
  await expectNoWcagAAIssues(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Uso y límites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retención de analítica" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
  await expectNoWcagAAIssues(page);
});

test("el centro de seguridad minimiza actividad y permite cerrar la sesión actual", async ({ page }) => {
  test.setTimeout(360_000);
  await registerVerifyAndLogin(page, "security-center-validation");

  const centerResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/security-center")
      && response.request().method() === "GET");
  await page.goto("/app/security");
  expect((await centerResponse).status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Centro de seguridad" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Protección adicional pendiente" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeVisible();
  await expect(page.getByText("Esta vista omite metadatos internos")).toBeVisible();

  const currentSession = page.locator("article.session").filter({ hasText: "Esta sesión" });
  await expect(currentSession).toHaveCount(1);
  await currentSession.getByRole("button", { name: "Cerrar" }).click();

  const revokeResponse = page.waitForResponse((response) =>
    /\/api\/v1\/auth\/sessions\/[^/]+\/revoke$/.test(response.url())
      && response.request().method() === "POST");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar sesión" }).click();
  expect((await revokeResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/auth\?reason=session-expired$/);

  // A direct navigation gives the revoked bearer a new chance to prove it is
  // unusable without depending on browser back-forward cache behaviour.
  await page.goto("/app/security");
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Fapp%2Fsecurity$/);
});

test("el centro de seguridad revoca una sesión remota sin cerrar la actual", async ({ page, browser }) => {
  test.setTimeout(480_000);
  const { email } = await registerVerifyAndLogin(page, "security-remote-session");
  const remoteContext = await browser.newContext();
  const remotePage = await remoteContext.newPage();

  try {
    await installHCaptchaBridge(remotePage);
    await loginFromBrowser(remotePage, email);
    await expect(remotePage).toHaveURL(/\/app\/(dashboard|getting-started)$/);

    await page.goto("/app/security");
    await expect(page.getByRole("heading", { name: "Centro de seguridad" })).toBeVisible();
    const remoteSession = page.locator("article.session").filter({ hasText: "Otra sesión" });
    await expect(remoteSession).toHaveCount(1);
    await expectNoWcagAAIssues(page);

    const revokeResponse = page.waitForResponse((response) =>
      /\/api\/v1\/auth\/sessions\/[^/]+\/revoke$/.test(response.url())
        && response.request().method() === "POST");
    await remoteSession.getByRole("button", { name: "Revocar" }).click();
    const dialog = page.getByRole("alertdialog");
    // Destructive dialogs deliberately focus the safe action first. Revocation
    // therefore needs a separate, explicit user action after focus is trapped.
    await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
    const confirmButton = dialog.getByRole("button", { name: "Revocar acceso" });
    await confirmButton.click();
    expect((await revokeResponse).status()).toBe(200);
    await expect(remoteSession).toHaveCount(0);
    await expect(page.locator("article.session").filter({ hasText: "Esta sesión" })).toHaveCount(1);

    // The remote browser must discover revocation on its next authenticated
    // request, while the revoking browser keeps its independent live session.
    await remotePage.goto("/app/security");
    await expect(remotePage).toHaveURL(/\/auth\?returnTo=%2Fapp%2Fsecurity$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Centro de seguridad" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await expectNoWcagAAIssues(page);
  } finally {
    await remoteContext.close();
  }
});

test("una sesión MFA caducada reautentica administración y registra el evento", async ({ page }) => {
  test.setTimeout(600_000);
  const { email } = await registerVerifyAndLogin(page, "security-reauthentication");

  await page.goto("/app/settings#security");
  await page.getByLabel("Contraseña actual").filter({ visible: true }).last().fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Empezar configuración" }).click();
  const secret = (await page.locator(".mfa-secret code").textContent())?.trim() ?? "";
  expect(secret).not.toBe("");
  await page.getByLabel("Código de la nueva aplicación").fill(currentTotp(secret));
  const enableResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/mfa/enable"));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  expect((await enableResponse).status()).toBe(200);

  // Recovery codes are single-display credentials. Keep two only in process:
  // one creates a fresh admin session and the other performs the step-up.
  const recoveryCodes = await page.locator("[aria-label='Códigos de recuperación'] code").evaluateAll((codes) =>
    codes.slice(0, 2).map((code) => code.textContent?.trim() ?? ""));
  expect(recoveryCodes).toHaveLength(2);
  expect(recoveryCodes.every(Boolean)).toBe(true);
  await page.getByRole("checkbox", { name: /He guardado los códigos/ }).check();
  await page.getByRole("button", { name: "Finalizar configuración" }).click();

  await promoteE2EAdmin(email);
  await logoutFromBrowser(page);
  await loginFromBrowser(page, email);
  await page.getByRole("button", { name: "Usar un código de recuperación" }).click();
  await page.getByRole("textbox", { name: "Código de recuperación" }).fill(recoveryCodes[0]);
  await page.getByRole("button", { name: "Usar código y entrar" }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);

  await ageE2EMfaSession(email);
  await page.goto("/app/admin");
  await expect(page).toHaveURL(/\/auth\/reauthenticate\?returnTo=%2Fapp%2Fadmin$/);
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toBeVisible();
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Código de autenticación o recuperación").fill(recoveryCodes[1]);
  const reauthenticateResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/mfa/reauthenticate")
      && response.request().method() === "POST");
  await page.getByRole("button", { name: "Continuar a administración" }).click();
  expect((await reauthenticateResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();

  await page.goto("/app/security");
  await expect(page.getByText("Reautenticación MFA completada", { exact: true })).toBeVisible();
  await expect(page.locator("article.session").filter({ hasText: "Esta sesión · MFA verificado" })).toHaveCount(1);
});

test("la purga irreversible exige frase y contraseña y elimina el enlace", async ({ page }) => {
  test.setTimeout(600_000);
  await registerVerifyAndLogin(page, "trash-purge-validation");
  await createWorkspaceFromBrowser(page, "Purga E2E");

  await page.goto("/app/links");
  await page.getByRole("main").getByRole("button", { name: "Nuevo enlace" }).click();
  const alias = `purge-${Date.now()}`;
  await page.getByLabel("URL de destino").fill("https://example.com/disposable");
  await page.getByLabel("Alias (opcional)").fill(alias);
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/links") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Crear enlace", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  const deleteResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+$/.test(response.url())
      && response.request().method() === "DELETE");
  await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar enlace" }).click();
  expect((await deleteResponse).status()).toBe(200);

  await page.goto("/app/links/trash");
  const deletedRow = page.locator(".trash-row").filter({ hasText: alias });
  await expect(deletedRow).toBeVisible();
  await deletedRow.getByRole("button", { name: "Borrar definitivamente" }).click();

  const confirmation = deletedRow.getByLabel("Confirmación de borrado definitivo");
  const purgeButton = confirmation.getByRole("button", { name: "Confirmar borrado irreversible" });
  await expect(purgeButton).toBeDisabled();
  await confirmation.getByLabel("Frase exacta").fill(`ELIMINAR ${alias}`);
  await confirmation.getByLabel("Contraseña actual").fill(E2E_PASSWORD);
  await expect(purgeButton).toBeEnabled();

  const purgeResponse = page.waitForResponse((response) =>
    /\/api\/v1\/links\/\d+\/purge$/.test(response.url())
      && response.request().method() === "POST");
  await purgeButton.click();
  // Purge deliberately has two independent confirmations: typed credentials
  // in the page and a final destructive alert dialog.
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar definitivamente" }).click();
  expect((await purgeResponse).status()).toBe(200);
  await expect(deletedRow).toHaveCount(0);
  await expect(page.getByText("La papelera está vacía")).toBeVisible();
});
