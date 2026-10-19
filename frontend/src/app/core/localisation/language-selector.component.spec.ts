import { DOCUMENT } from "@angular/common";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActionDialogService } from "../../panel/action-dialog.service";
import { AuthService } from "../services/auth.service";
import { ApiService } from "../services/api.service";
import { LanguageSelectorComponent } from "./language-selector.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Language selection context and handoff", () => {
  const user = signal<{ id: number; language: "es" | "en" } | null>(null);
  const generation = signal(1);
  let document: { cookie: string; querySelector: jasmine.Spy; defaultView: { location: { protocol: string; pathname: string; search: string; hash: string; assign: jasmine.Spy } } };
  let api: { patch: jasmine.Spy };
  let dialogs: { confirm: jasmine.Spy };
  let component: LanguageSelectorComponent;
  const event = () => ({ target: { value: "en" } }) as unknown as Event;

  beforeEach(() => {
    user.set({ id: 1, language: "es" }); generation.set(1);
    document = { cookie: "", querySelector: jasmine.createSpy().and.returnValue(null), defaultView: { location: {
      protocol: "https:", pathname: "/es/auth/verify-email", search: "?next=opaque%20value", hash: "#token=Opaque_1&key=2", assign: jasmine.createSpy(),
    } } };
    api = { patch: jasmine.createSpy().and.resolveTo({ language: "en" }) };
    dialogs = { confirm: jasmine.createSpy().and.resolveTo(true) };
    TestBed.configureTestingModule({ providers: [
      { provide: DOCUMENT, useValue: document }, { provide: ApiService, useValue: api },
      { provide: ActionDialogService, useValue: dialogs }, { provide: AuthService, useValue: { user, sessionGeneration: generation } },
    ] });
    component = TestBed.runInInjectionContext(() => new LanguageSelectorComponent());
  });

  it("saves explicitly and preserves opaque verification data in the equivalent route", async () => {
    await component.change(event());
    expect(api.patch).toHaveBeenCalledOnceWith("/api/v1/auth/language", { language: "en" }, jasmine.any(Function));
    expect(document.cookie).toContain("uvh_language=en;");
    expect(document.cookie).toContain("SameSite=Lax; Secure");
    expect(document.defaultView.location.assign).toHaveBeenCalledOnceWith("/en/auth/verify-email?next=opaque%20value#token=Opaque_1&key=2");
    expect(component.busy()).toBeFalse();
  });

  it("does not save for another account after an awaited discard confirmation", async () => {
    const confirmation = deferred<boolean>();
    document.querySelector.and.returnValue({}); dialogs.confirm.and.returnValue(confirmation.promise);
    const pending = component.change(event());
    user.set({ id: 2, language: "es" }); generation.set(2); confirmation.resolve(true);
    await pending;
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.defaultView.location.assign).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });

  it("discards a late response after the originating session changes", async () => {
    const request = deferred<unknown>(); api.patch.and.returnValue(request.promise);
    const pending = component.change(event());
    generation.set(2); request.resolve({ language: "en" }); await pending;
    expect(document.defaultView.location.assign).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });

  it("retains the current page when discard is cancelled or the server rejects the change", async () => {
    document.querySelector.and.returnValue({}); dialogs.confirm.and.resolveTo(false);
    await component.change(event()); expect(api.patch).not.toHaveBeenCalled();
    document.querySelector.and.returnValue(null); api.patch.and.rejectWith(new Error("Fixture"));
    await component.change(event()); expect(component.error()).not.toBe("");
    expect(document.defaultView.location.assign).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });
});

describe("Language menu presentation", () => {
  it("uses a compact trigger, full menu labels and restores keyboard focus", async () => {
    const { provideNoopAnimations } = await import("@angular/platform-browser/animations");
    const { MatMenuTrigger } = await import("@angular/material/menu");
    const { By } = await import("@angular/platform-browser");
    await TestBed.configureTestingModule({ imports: [LanguageSelectorComponent], providers: [
      provideNoopAnimations(),
      { provide: ApiService, useValue: {} }, { provide: ActionDialogService, useValue: {} },
      { provide: AuthService, useValue: { user: signal(null), sessionGeneration: signal(1) } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(LanguageSelectorComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(trigger.textContent).toContain("ES");
    expect(trigger.getAttribute("aria-label")).toContain("Español");
    expect(fixture.nativeElement.querySelector("select")).toBeNull();
    trigger.focus(); trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const options = document.querySelectorAll<HTMLElement>(".uvh-language-menu [role=menuitemradio]");
    expect(options.length).toBe(3);
    expect(options[0].textContent).toContain("Español");
    expect(options[1].textContent).toContain("English");
    expect(options[2].textContent).toContain("Français");
    expect(options[0].getAttribute("aria-checked")).toBe("true");
    fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger).closeMenu();
    fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
    fixture.componentRef.setInput("fullName", true); fixture.detectChanges();
    expect(trigger.textContent).toContain("Español");
    fixture.destroy();
  });
});
