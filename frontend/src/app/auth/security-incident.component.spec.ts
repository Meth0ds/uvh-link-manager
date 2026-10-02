import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Location } from "@angular/common";
import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { of, Subject, throwError } from "rxjs";
import { AuthService } from "../core/services/auth.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { SecurityIncidentComponent } from "./security-incident.component";

describe("security incident boundaries", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: jasmine.SpyObj<AuthService>;
  let fixture: ComponentFixture<SecurityIncidentComponent>;
  let component: SecurityIncidentComponent;

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["post", "get"]);
    auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut"]);
    auth.sessionGeneration.and.returnValue(9);
    TestBed.configureTestingModule({
      imports: [SecurityIncidentComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: `token=${"t".repeat(43)}`, queryParamMap: { get: () => null } } } },
        { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
        { provide: PendingInvitationService, useValue: { pending: signal(false) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
      ],
    });
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    fixture = TestBed.createComponent(SecurityIncidentComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it("requires an explicit action and strips the bearer from the address", () => {
    fixture.detectChanges();
    expect(http.post).not.toHaveBeenCalled();
    expect(TestBed.inject(Location).replaceState).toHaveBeenCalledWith("/auth/security-incident");
    expect(fixture.nativeElement.textContent).toContain("Revocar todos los accesos");
  });

  for (const current of [true, false]) {
    it(`reconciles only the affected identity (current=${current})`, async () => {
      http.post.and.returnValue(of({ ok: true, message: "Accesos revocados", current }));
      await component.revoke();
      expect(component.ok()).toBeTrue();
      expect(component.done()).toBeTrue();
      expect(auth.accountSignedOut).toHaveBeenCalledTimes(current ? 1 : 0);
      if (current) expect(auth.accountSignedOut).toHaveBeenCalledWith(9);
      await component.revoke();
      expect(http.post).toHaveBeenCalledTimes(1);
    });
  }

  for (const payload of [null, {}, { ok: false, message: "secret", current: true }, { ok: true, message: "secret" }, { ok: true, message: "secret", current: "true" }]) {
    it(`rejects a malformed confirmation ${JSON.stringify(payload)}`, async () => {
      http.post.and.returnValue(of(payload));
      await component.revoke();
      expect(component.ok()).toBeFalse();
      expect(auth.accountSignedOut).not.toHaveBeenCalled();
      expect(component.message()).toBe("El servidor devolvió una respuesta no válida");
      expect(component.busy()).toBeFalse();
    });
  }

  for (const status of [0, 429, 500, 503]) {
    it(`allows a deliberate retry after HTTP ${status}`, async () => {
      http.post.and.returnValues(
        throwError(() => new HttpErrorResponse({ status, error: { error: "Error temporal" } })),
        of({ ok: true, message: "Accesos revocados", current: false }),
      );
      await component.revoke();
      expect(component.done()).toBeFalse();
      expect(component.busy()).toBeFalse();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain("Reintentar revocación");
      await component.revoke();
      expect(http.post).toHaveBeenCalledTimes(2);
      expect(component.ok()).toBeTrue();
    });
  }

  it("stops retrying a consumed or expired bearer", async () => {
    http.post.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: "Enlace inválido" } })));
    await component.revoke();
    expect(component.done()).toBeTrue();
    await component.revoke();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(auth.accountSignedOut).not.toHaveBeenCalled();
  });

  it("does not submit twice while the first revocation is pending", async () => {
    const response = new Subject<unknown>();
    http.post.and.returnValue(response);
    const first = component.revoke();
    await Promise.resolve();
    await component.revoke();
    expect(http.post).toHaveBeenCalledTimes(1);
    response.next({ ok: true, current: true, message: "Accesos revocados" });
    response.complete();
    await first;
    expect(component.ok()).toBeTrue();
    expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(9);
  });

  it("preserves another identity when the view is destroyed before confirmation", async () => {
    const response = new Subject<unknown>();
    http.post.and.returnValue(response);
    const revocation = component.revoke();
    await Promise.resolve();
    fixture.destroy();
    response.next({ ok: true, current: false, message: "Accesos revocados" });
    response.complete();
    await revocation;
    expect(auth.accountSignedOut).not.toHaveBeenCalled();
    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });
});
