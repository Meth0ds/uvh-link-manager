import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { AppComponent } from "./app.component";
import { AuthService } from "./core/services/auth.service";

describe("AppComponent startup", () => {
  for (const path of ["/app/settings", "/app/links?page=2", "/app/admin/users"]) {
    it(`routes a fresh-MFA request from ${path} to reauthentication with a local return address`, () => {
      const auth = {
        init: jasmine.createSpy("init").and.resolveTo(),
        authenticated: signal(true),
        sessionInvalidated: signal(false),
        adminMfaReauthenticationRequired: signal(true),
      };
      TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
      const router = TestBed.inject(Router);
      spyOnProperty(router, "url", "get").and.returnValue(path);
      const navigate = spyOn(router, "navigate").and.resolveTo(true);
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      expect(navigate).toHaveBeenCalledOnceWith(["/auth/reauthenticate"], { queryParams: { returnTo: path } });
    });
  }

  for (const [path, authenticated] of [["/help", true], ["/app/settings", false], ["/app/admin/users", false]] as const) {
    it(`does not redirect a stale MFA flag from ${path} with authenticated=${authenticated}`, () => {
      const auth = {
        init: jasmine.createSpy("init").and.resolveTo(),
        authenticated: signal(authenticated),
        sessionInvalidated: signal(false),
        adminMfaReauthenticationRequired: signal(true),
      };
      TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
      const router = TestBed.inject(Router);
      spyOnProperty(router, "url", "get").and.returnValue(path);
      const navigate = spyOn(router, "navigate").and.resolveTo(true);
      const fixture = TestBed.createComponent(AppComponent);
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
    });
  }

  it("starts session discovery without blocking the public shell", () => {
    const neverSettles = new Promise<void>(() => undefined);
    const auth = {
      init: jasmine.createSpy("init").and.returnValue(neverSettles),
      authenticated: signal(false),
      sessionInvalidated: signal(false),
      adminMfaReauthenticationRequired: signal(false),
    };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(auth.init).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
