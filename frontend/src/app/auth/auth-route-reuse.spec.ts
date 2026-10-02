import { Component, DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, RouteReuseStrategy } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { appConfig, routes } from "../app.config";
import { authRoutes } from "./auth.routes";
import { authBearer } from "./auth-bearer";

@Component({ standalone: true, template: "{{ token }}" })
class BearerScreen {
  readonly token = authBearer(inject(ActivatedRoute));
  destroyed = false;
  constructor() { inject(DestroyRef).onDestroy(() => { this.destroyed = true; }); }
}

describe("auth navigation lifecycle", () => {
  const paths = ["", "verify-email", "confirm-email", "confirm-account-deletion", "cancel-account-deletion", "reset-password", "security-incident", "account-recovery/confirm", "account-recovery/complete", "reauthenticate", "invitations/accept"];

  function providers() {
    const reuse = appConfig.providers.filter(p => (p as { provide?: unknown })?.provide === RouteReuseStrategy);
    return [provideRouter(authRoutes.map(r => ({ path: r.path, data: r.data, component: BearerScreen }))), ...reuse];
  }

  for (const path of paths) {
    it(`replaces snapshot and pending work for a second link on /auth/${path}`, async () => {
      TestBed.configureTestingModule({ providers: providers() });
      const harness = await RouterTestingHarness.create();
      const first = await harness.navigateByUrl(`/${path}#token=${"a".repeat(43)}`, BearerScreen);
      const second = await harness.navigateByUrl(`/${path}#token=${"b".repeat(43)}`, BearerScreen);
      expect(first.destroyed).toBeTrue();
      expect(second).not.toBe(first);
      expect(second.token).toBe("b".repeat(43));
    });
  }

  it("preserves the regular route reuse policy on forms without snapshot authority", async () => {
    TestBed.configureTestingModule({ providers: providers() });
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl("/forgot-password?display=first", BearerScreen);
    const second = await harness.navigateByUrl("/forgot-password?display=second", BearerScreen);
    expect(second).toBe(first);
    expect(first.destroyed).toBeFalse();
  });

  it("renews the canonical invitation alias too", async () => {
    const invitation = routes.find(r => r.path === "invitations/accept")!;
    const reuse = appConfig.providers.filter(p => (p as { provide?: unknown })?.provide === RouteReuseStrategy);
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: invitation.path, data: invitation.data, component: BearerScreen }]), ...reuse] });
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl("/invitations/accept#token=" + "a".repeat(43), BearerScreen);
    const second = await harness.navigateByUrl("/invitations/accept#token=" + "b".repeat(43), BearerScreen);
    expect(first.destroyed).toBeTrue();
    expect(second.token).toBe("b".repeat(43));
  });
});
