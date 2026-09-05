import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { AppComponent } from "./app.component";
import { AuthService } from "./core/services/auth.service";

describe("AppComponent startup", () => {
  it("starts session discovery without blocking the public shell", () => {
    const neverSettles = new Promise<void>(() => undefined);
    const auth = {
      init: jasmine.createSpy("init").and.returnValue(neverSettles),
      authenticated: signal(false),
      sessionInvalidated: signal(false),
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
