import { Location } from "@angular/common";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, convertToParamMap } from "@angular/router";
import { MfaReauthenticateComponent } from "./mfa-reauthenticate.component";
import { InvitationAcceptComponent } from "./invitation-accept.component";
import { AuthService } from "../core/services/auth.service";
import { ApiService } from "../core/services/api.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";

describe("Security flow presentation", () => {
  let post: jasmine.Spy;
  let reauthenticate: jasmine.Spy;
  beforeEach(async () => {
    post = jasmine.createSpy("post"); reauthenticate = jasmine.createSpy("reauthenticate");
    await TestBed.configureTestingModule({ imports: [MfaReauthenticateComponent, InvitationAcceptComponent], providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { fragment: null, queryParamMap: convertToParamMap({}) } } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
      { provide: ApiService, useValue: { post } },
      { provide: AuthService, useValue: { loaded: () => true, authenticated: () => true, sessionGeneration: () => 1, user: () => ({ isAdmin: true }), mfaSessionStatus: async () => ({ enabled: true, fresh: false }), reauthenticateMfa: reauthenticate } },
      // The invitation is parked on the server, so the panel answers "there is
      // one" without being able to read any bearer: what it renders must come
      // from the server's yes/no, not from a token in the page.
      {
        provide: PendingInvitationService,
        useValue: {
          pending: signal(true),
          revision: signal(0),
          expiresAt: signal(new Date(Date.now() + 60_000).toISOString()),
          persistent: signal(true),
          capture: jasmine.createSpy("capture").and.returnValue(false),
          confirmed: jasmine.createSpy("confirmed").and.resolveTo(true),
          refresh: jasmine.createSpy("refresh").and.resolveTo(undefined),
          forget: jasmine.createSpy("forget").and.resolveTo(undefined),
          hide: jasmine.createSpy("hide"),
        },
      },
    ] }).compileComponents();
  });
  it("explains recovery codes without submitting authentication or exposing a factor", async () => {
    const fixture = TestBed.createComponent(MfaReauthenticateComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".factor-help").textContent).toContain("sirve una sola vez");
    expect(fixture.nativeElement.querySelector('input[formControlName="factorCode"]').getAttribute("autocomplete")).toBe("one-time-code");
    expect(fixture.nativeElement.querySelector("button.submit").disabled).toBeTrue();
    expect(reauthenticate).not.toHaveBeenCalled();
  });
  it("shows a neutral initialization state before asking for credentials", async () => {
    const fixture = TestBed.createComponent(MfaReauthenticateComponent);
    await fixture.whenStable();
    fixture.componentInstance.initializing.set(true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("form")).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain("Comprobando la sesión");
  });
  it("explains both invitation choices without accepting automatically", async () => {
    const fixture = TestBed.createComponent(InvitationAcceptComponent); fixture.detectChanges();
    // The decision only exists once the server has confirmed the park.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll(".decision-guide h3").length).toBe(2);
    expect(fixture.nativeElement.querySelector(".decision-guide").textContent).toContain("quedará invalidado");
    expect(post).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain("fictional-only");
  });
  it("does not show a login failure while an invitation is processing", () => {
    const fixture = TestBed.createComponent(InvitationAcceptComponent);
    fixture.componentInstance.busy.set(true); fixture.componentInstance.ready.set(false); fixture.componentInstance.done.set(true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("#invitation-accept-title").textContent).toBe("Procesando invitación");
    expect(fixture.nativeElement.querySelector(".icon.bad")).toBeNull();
    expect(fixture.nativeElement.querySelector(".invitation-actions")).toBeNull();
  });
  it("distinguishes discarding a local invitation from rejecting it remotely", async () => {
    const fixture = TestBed.createComponent(InvitationAcceptComponent);
    // Wait for the park confirmation: only then does the screen stop being busy.
    await fixture.whenStable();
    fixture.componentInstance.ready.set(false); fixture.componentInstance.done.set(true); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Descartar de este navegador");
    expect(fixture.nativeElement.textContent).toContain("no equivale a rechazarla");
    expect(post).not.toHaveBeenCalled();
  });
});
