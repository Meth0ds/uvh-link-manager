import { Component, signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
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

describe("Panel creation navigation", () => {
  let fixture: ComponentFixture<PanelComponent>;
  let router: Router;
  let mobile: BehaviorSubject<{ matches: boolean; breakpoints: Record<string, boolean> }>;
  let list: ReturnType<typeof signal<Workspace[]>>;
  const sidebarCreate = () => fixture.nativeElement.querySelector(".side-primary") as HTMLButtonElement | null;
  beforeEach(async () => {
    mobile = new BehaviorSubject<{ matches: boolean; breakpoints: Record<string, boolean> }>({ matches: false, breakpoints: {} });
    list = signal<Workspace[]>([{ id: 1, name: "Workspace", slug: "workspace", role: "owner", createdAt: "2026-10-07T00:00:00Z" }]);
    await TestBed.configureTestingModule({ imports: [PanelComponent], providers: [
      provideRouter([...["app/dashboard", "app/links", "app/links/:id", "app/domains", "app/getting-started"].map(path => ({ path, component: ChildPage })),
        { path: "app", redirectTo: "app/dashboard", pathMatch: "full" }]),
      { provide: AuthService, useValue: { user: signal({ id: 10, name: "Ana", emailVerified: true, isAdmin: false }) } },
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
  afterEach(() => fixture.destroy());
  it("keeps contextual creation on the dashboard without duplicate global buttons", () => {
    expect(fixture.componentInstance.hasContextualCreate()).toBeTrue();
    expect(sidebarCreate()).toBeNull(); expect(fixture.nativeElement.querySelector(".new-link-top")).toBeNull();
  });
  it("uses the redirected route and ignores queries and fragments", async () => {
    await router.navigateByUrl("/app/links?state=active#selection"); fixture.detectChanges();
    expect(sidebarCreate()).toBeNull();
    await router.navigateByUrl("/app"); fixture.detectChanges();
    expect(fixture.componentInstance.hasContextualCreate()).toBeTrue(); expect(sidebarCreate()).toBeNull();
  });
  it("retains one global creation action on detail and other pages", async () => {
    for (const path of ["/app/links/7", "/app/domains", "/app/getting-started"]) {
      await router.navigateByUrl(path); fixture.detectChanges();
      expect(sidebarCreate()).not.toBeNull(); expect(fixture.nativeElement.querySelectorAll(".side-primary").length).toBe(1);
      expect(fixture.nativeElement.querySelector(".new-link-top")).toBeNull();
    }
  });
  it("retains the mobile drawer action on contextual pages", () => {
    mobile.next({ matches: true, breakpoints: {} }); fixture.detectChanges();
    expect(sidebarCreate()).not.toBeNull();
    mobile.next({ matches: false, breakpoints: {} }); fixture.detectChanges(); expect(sidebarCreate()).toBeNull();
  });
  it("does not offer creation to viewers even in the mobile drawer", () => {
    mobile.next({ matches: true, breakpoints: {} }); list.update(rows => rows.map(row => ({ ...row, role: "viewer" })));
    fixture.detectChanges(); expect(sidebarCreate()).toBeNull(); expect(fixture.componentInstance.canCreate()).toBeFalse();
  });
});
