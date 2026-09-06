import { expect, test } from "@playwright/test";
import { loginFromBrowser, registerVerifyAndLogin } from "../support/auth";
import { installHCaptchaBridge } from "../support/hcaptcha";
import { readMailLink } from "../support/mail";
import { createWorkspaceFromBrowser } from "../support/workspace";

test.beforeEach(async ({ page }) => {
  await installHCaptchaBridge(page);
});

test("una invitación sólo concede acceso tras aceptarla con el destinatario verificado", async ({ page }) => {
  test.setTimeout(600_000);
  const { email: inviteeEmail } = await registerVerifyAndLogin(page, "invitee");
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();

  const { email: ownerEmail } = await registerVerifyAndLogin(page, "inviter");
  const workspaceName = await createWorkspaceFromBrowser(page, "Colaboración E2E");
  await page.goto("/app/team");
  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByRole("combobox", { name: "Rol" }).click();
  await page.getByRole("option", { name: "Visor" }).click();
  const invitationPromise = page.waitForResponse((response) =>
    /\/api\/v1\/workspaces\/\d+\/invitations$/.test(response.url())
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Invitar" }).click();
  expect((await invitationPromise).status()).toBe(201);
  await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
  const invitationUrl = await readMailLink(inviteeEmail, "invitation");

  // The invitation bearer is consumed only after switching from the issuer to
  // the exact verified recipient; opening it as the issuer grants nothing.
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await loginFromBrowser(page, inviteeEmail);
  // Wait for the session cookie and global auth state before consuming the
  // invitation; navigating earlier can legitimately reach the login gate.
  await expect(page).toHaveURL(/\/app\/(dashboard|getting-started)$/);
  await page.goto(invitationUrl);
  await expect(page.getByRole("heading", { name: "Revisar invitación" })).toBeVisible();
  const acceptPromise = page.waitForResponse((response) => response.url().endsWith("/api/v1/workspaces/invitations/accept"));
  await page.getByRole("button", { name: "Aceptar invitación" }).click();
  expect((await acceptPromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Invitación aceptada" })).toBeVisible();
  await page.getByRole("link", { name: "Ir a mi panel" }).click();
  // Acceptance adds the workspace but deliberately preserves the user's
  // current workspace. Select the new membership explicitly before asserting.
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: workspaceName, exact: true }).click();
  await expect(page.getByText(workspaceName, { exact: true }).first()).toBeVisible();

  // Keep the issuer identifier live in the scenario so accidental account
  // reuse or a future test refactor cannot silently erase that boundary.
  expect(ownerEmail).not.toBe(inviteeEmail);
});
