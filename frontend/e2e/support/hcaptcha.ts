import type { Page } from "@playwright/test";

/**
 * Replaces only UVH's sandboxed bridge document. The application still runs
 * its real invisible-widget protocol and the backend still verifies every
 * fresh token against the isolated siteverify service.
 */
export async function installHCaptchaBridge(page: Page): Promise<void> {
  await page.route("**/hcaptcha-frame.html*", async (route) => {
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><meta charset="utf-8">
        <button type="button" id="complete">Completar comprobación</button>
        <script>
        let channel = "";
        const token = () => "uvh-e2e-pass-" + crypto.randomUUID();
        const send = (type, extra = {}) => parent.postMessage({
          source: "uvh-hcaptcha-frame", channel, type, ...extra
        }, "*");
        document.querySelector("#complete").addEventListener("click", () => {
          send("verified", { token: token() });
        });
        addEventListener("message", (event) => {
          const message = event.data || {};
          if (event.source !== parent || message.source !== "uvh-hcaptcha-host") return;
          if (message.type === "init") {
            channel = message.channel;
            send("ready");
          } else if (message.channel === channel && message.type === "execute") {
            send("verified", { token: token() });
          } else if (message.channel === channel && message.type === "reset") {
            send("ready");
          }
        });
        send("frame-ready");
      </script>`,
    });
  });
}

/** Completes the visible challenge used by recovery and resend forms. */
export async function completeVisibleHCaptcha(page: Page): Promise<void> {
  await page
    .frameLocator('iframe[title="Comprobación de hCaptcha"]')
    .getByRole("button", { name: "Completar comprobación" })
    .click();
}
