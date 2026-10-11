import { Component, signal } from "@angular/core";
import { fakeAsync, tick, TestBed, type ComponentFixture } from "@angular/core/testing";
import { BreakpointObserver } from "@angular/cdk/layout";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router, provideRouter } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { AuthService } from "../core/services/auth.service";
import { NotificationService } from "../core/services/notification.service";
import { WorkspaceService } from "../core/services/workspace.service";
import type { Workspace } from "../core/models";
import { LinkDialogService } from "./links/link-dialog.service";
import { PanelComponent } from "./panel.component";

@Component({ standalone: true, template: "Página de prueba" })
class ChildPage {}

describe("Panel main navigation rail", () => {
  let fixture: ComponentFixture<PanelComponent>;
  let router: Router;
  let mobile: BehaviorSubject<{ matches: boolean; breakpoints: Record<string, boolean> }>;
  let list: ReturnType<typeof signal<Workspace[]>>;
  let user: ReturnType<typeof signal<{ id: number; name: string; emailVerified: boolean; isAdmin: boolean }>>;
  const preference = (id = 10) => `uvh.navigation.pinned.v1.${id}`;
  const shell = () => fixture.nativeElement.querySelector(".shell") as HTMLElement;
  const side = () => fixture.nativeElement.querySelector(".side") as HTMLElement;
  beforeEach(async () => {
    localStorage.removeItem(preference()); localStorage.removeItem(preference(20));
    user = signal({ id: 10, name: "Ana", emailVerified: true, isAdmin: true });
    mobile = new BehaviorSubject<{ matches: boolean; breakpoints: Record<string, boolean> }>({ matches: false, breakpoints: {} });
    list = signal<Workspace[]>([{ id: 1, name: "Workspace", slug: "workspace", role: "owner", createdAt: "2026-10-07T00:00:00Z" }]);
    await TestBed.configureTestingModule({ imports: [PanelComponent], providers: [
      provideRouter([...["app/dashboard", "app/links", "app/links/:id", "app/domains", "app/getting-started", "app/admin", "app/admin/:section"].map(path => ({ path, component: ChildPage })),
        { path: "app", redirectTo: "app/dashboard", pathMatch: "full" }]),
      { provide: AuthService, useValue: { user } },
      { provide: WorkspaceService, useValue: { currentId: signal(1), list } },
      { provide: LinkDialogService, useValue: { openCreate: jasmine.createSpy("openCreate") } },
      { provide: NotificationService, useValue: { unread: signal(0), refreshUnread: () => Promise.resolve(0) } },
      { provide: MatDialog, useValue: {} }, { provide: MatSnackBar, useValue: {} },
      { provide: BreakpointObserver, useValue: { observe: () => mobile } },
    ] }).compileComponents();
    router = TestBed.inject(Router);
    await router.navigateByUrl("/app/dashboard");
    fixture = TestBed.createComponent(PanelComponent); fixture.detectChanges(); await fixture.whenStable();
  });
  afterEach(() => { fixture.destroy(); localStorage.removeItem(preference()); localStorage.removeItem(preference(20)); });
  it("keeps the main menu compact throughout the desktop dashboard", async () => {
    for (const path of ["/app/dashboard", "/app/links", "/app/links/12", "/app/domains", "/app/getting-started", "/app/admin?section=users#queue", "/app/admin/domains"]) {
      await router.navigateByUrl(path); fixture.detectChanges();
      expect(shell().classList.contains("navigation-rail")).toBeTrue();
      expect(side().classList.contains("navigation-expanded")).toBeFalse();
      const links = [...side().querySelectorAll<HTMLAnchorElement>(".nav-item")];
      expect(links.length).toBeGreaterThan(0);
      expect(links.every(link => Boolean(link.getAttribute("aria-label")))).toBeTrue();
    }
  });
  it("reveals labels for pointer and keyboard without losing focus between links", fakeAsync(() => {
    side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })); tick(70); fixture.detectChanges();
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    side().dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })); tick(100); fixture.detectChanges();
    expect(side().classList.contains("navigation-expanded")).toBeFalse();
    (side().querySelector(".nav-item") as HTMLAnchorElement).focus(); fixture.detectChanges();
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    side().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: side().querySelector("a") })); fixture.detectChanges();
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    side().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: fixture.nativeElement.querySelector(".navigation-pin") })); fixture.detectChanges();
    expect(side().classList.contains("navigation-expanded")).toBeFalse();
  }));

  it("ignores a passing pointer and allows a brief exit without flickering", fakeAsync(() => {
    const enter = () => side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    const leave = () => side().dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    enter(); tick(40); leave(); tick(150); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeFalse();
    enter(); tick(70); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeTrue();
    leave(); tick(60); enter(); tick(100); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeTrue();
    leave(); tick(100); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeFalse();
  }));

  it("does not interpret touch as hovering over a desktop rail", fakeAsync(() => {
    side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" })); tick(200); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeFalse();
  }));

  it("remembers the explicit preference across reloads and keeps it personal", async () => {
    const pin = () => fixture.nativeElement.querySelector(".navigation-pin") as HTMLButtonElement;
    pin().click(); fixture.detectChanges();
    expect(localStorage.getItem(preference())).toBe("true");
    fixture.destroy(); fixture = TestBed.createComponent(PanelComponent); fixture.detectChanges(); await fixture.whenStable();
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    user.set({ ...user(), id: 20 }); fixture.detectChanges();
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    user.set({ ...user(), id: 10 }); fixture.detectChanges();
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    pin().click(); fixture.detectChanges();
    expect(localStorage.getItem(preference())).toBe("false");
  });

  it("keeps the navigation usable when persistence is denied", () => {
    spyOn(Storage.prototype, "setItem").and.throwError("Storage unavailable");
    expect(() => fixture.componentInstance.toggleMainNavPinned()).not.toThrow(); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavPinned()).toBeTrue();
  });

  it("dismisses a temporary reveal with Escape without immediately reopening", fakeAsync(() => {
    side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })); tick(70); fixture.detectChanges();
    const first = side().querySelector(".nav-item") as HTMLAnchorElement; first.focus(); fixture.detectChanges();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true })); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeFalse();
    expect(side().classList.contains("mat-drawer-opened")).toBeTrue();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector(".navigation-pin"));
    side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })); tick(100); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeFalse();
    side().dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    side().dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })); tick(70); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavExpanded()).toBeTrue();
    tick(100);
  }));

  it("does not erase the pinned preference when Escape belongs to another control", () => {
    fixture.componentInstance.toggleMainNavPinned(); fixture.detectChanges();
    shell().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); fixture.detectChanges();
    expect(fixture.componentInstance.mainNavPinned()).toBeTrue();
  });
  it("can pin the menu explicitly and retains the usual mobile drawer", async () => {
    await router.navigateByUrl("/app/admin"); fixture.detectChanges();
    const pin = fixture.nativeElement.querySelector(".navigation-pin") as HTMLButtonElement;
    pin.click(); fixture.detectChanges();
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    await router.navigateByUrl("/app/dashboard"); fixture.detectChanges();
    expect(shell().classList.contains("navigation-pinned")).toBeTrue();
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    pin.click(); fixture.detectChanges();
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(side().classList.contains("navigation-expanded")).toBeFalse();
    mobile.next({ matches: true, breakpoints: {} }); fixture.detectChanges();
    expect(shell().classList.contains("navigation-rail")).toBeFalse();
    expect(fixture.nativeElement.querySelector(".navigation-pin")).toBeNull();
    expect(side().classList.contains("navigation-expanded")).toBeTrue();
    const menu = fixture.nativeElement.querySelector(".menu-btn") as HTMLButtonElement;
    menu.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    side().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true })); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.mobileOpen()).toBeFalse();
  });
  it("opens a different page from the top while retaining same-page scroll", async () => {
    const main = fixture.nativeElement.querySelector("main") as HTMLElement;
    const content = fixture.nativeElement.querySelector(".main-inner") as HTMLElement;
    content.style.height = "2000px";
    main.scrollTop = 320;
    expect(main.scrollTop).toBe(320);
    await router.navigateByUrl("/app/dashboard?period=7#activity"); fixture.detectChanges();
    expect(main.scrollTop).toBe(320);
    await router.navigateByUrl("/app/admin"); fixture.detectChanges();
    expect(main.scrollTop).toBe(0);
  });

});
