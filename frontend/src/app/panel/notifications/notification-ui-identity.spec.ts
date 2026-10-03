import { signal } from "@angular/core";
import { fakeAsync, flushMicrotasks, TestBed } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Location } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { FormBuilder } from "@angular/forms";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { AuthUser, NotificationPreference } from "../../core/models";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { AuthService } from "../../core/services/auth.service";
import { ThemeService } from "../../core/services/theme.service";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "../settings/settings.component";
import { NotificationsComponent } from "./notifications.component";

const user: AuthUser = { id: 1, name: "A", email: "a@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
const preference: NotificationPreference = { kind: "api_token_created", category: "operational", delivery: "immediate" };
const inbox = { notifications: [{ id: 1, kind: "password_changed", subject: null, workspaceId: null, route: "/app/settings", createdAt: "2026-10-03T10:00:00Z", readAt: null }], unread: 1, nextCursor: null };

describe("Notification UI identity through the real HTTP boundary", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let snackbar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(() => {
    // HTTP is entirely in memory. The cookie getter supplies a fixture token;
    // this never writes cookies, sends mail or touches the local database.
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    snackbar = jasmine.createSpyObj("MatSnackBar", ["open"]);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), FormBuilder,
      { provide: Router, useValue: { navigate: jasmine.createSpy("navigate").and.resolveTo(true), navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
      { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
      { provide: MatSnackBar, useValue: snackbar },
      { provide: MatDialog, useValue: { open: jasmine.createSpy("open") } },
      { provide: ActionDialogService, useValue: jasmine.createSpyObj("ActionDialogService", ["confirm", "prompt"]) },
      { provide: ThemeService, useValue: { preference: signal("system"), set: jasmine.createSpy("set") } },
    ] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.user.set(user);
    // Unrelated constructor reads are independent of this notification contract.
    spyOn(auth, "listSessions").and.resolveTo({ sessions: [], truncated: false });
    spyOn(auth, "dataExportStatus").and.resolveTo(null);
    spyOn(auth, "dataExportHistory").and.resolveTo([]);
    spyOn(auth, "accountDeletionImpact").and.resolveTo({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null });
  });

  afterEach(() => http.verify());

  function settings(): SettingsComponent {
    const component = TestBed.runInInjectionContext(() => new SettingsComponent());
    http.expectOne((request) => request.url.includes("/privacy-requests")).flush({ requests: [], total: 0 });
    TestBed.tick();
    return component;
  }

  it("does not publish a successful preference response already queued when the session expires", fakeAsync(() => {
    const component = settings();
    const request = http.expectOne("/api/v1/notifications/preferences");
    expect(request.request.withCredentials).toBeTrue();
    request.flush({ preferences: [preference] });
    // The decoder has accepted the HTTP value; Settings has not resumed yet.
    auth.sessionExpired();
    TestBed.tick();
    flushMicrotasks();
    expect(auth.user()).toBeNull();
    expect(component.notificationPreferences()).toEqual([]);
    expect(component.notificationPrefsLoading()).toBeFalse();
  }));

  it("does not attribute a completed old PATCH to a replacement session of the same account", fakeAsync(() => {
    const component = settings();
    http.expectOne("/api/v1/notifications/preferences").flush({ preferences: [preference] });
    flushMicrotasks();
    void component.setNotificationDelivery(preference, "disabled");
    flushMicrotasks();
    const write = http.expectOne("/api/v1/notifications/preferences");
    expect(write.request.method).toBe("PATCH");
    expect(write.request.body).toEqual({ preferences: [{ kind: preference.kind, delivery: "disabled" }] });
    expect(write.request.headers.get("X-CSRF-Token")).toBe("fixture");
    const originalGeneration = auth.sessionGeneration();
    auth.accountSignedOut();
    TestBed.tick();
    void auth.me();
    http.expectOne("/api/v1/auth/me").flush({ user });
    flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
    flushMicrotasks();
    TestBed.tick();
    expect(auth.sessionGeneration()).toBeGreaterThan(originalGeneration);
    // The repaired component refreshes its new identity; the original has no read.
    for (const read of http.match("/api/v1/notifications/preferences")) read.flush({ preferences: [preference] });
    flushMicrotasks();
    expect(write.cancelled).toBeFalse();
    write.flush({ preferences: [{ ...preference, delivery: "disabled" }] });
    flushMicrotasks();
    expect(component.notificationPreferences()).toEqual([preference]);
    expect(snackbar.open).not.toHaveBeenCalled();
  }));

  it("clears an existing inbox when the real session invalidation removes the identity", fakeAsync(() => {
    const component = TestBed.runInInjectionContext(() => new NotificationsComponent());
    http.expectOne("/api/v1/notifications").flush(inbox);
    flushMicrotasks();
    TestBed.tick();
    expect(component.items().length).toBe(1);
    auth.sessionExpired();
    TestBed.tick();
    expect(component.items()).toEqual([]);
    expect(component.unread()).toBe(0);
    expect(component.loading()).toBeFalse();
  }));

  it("unsubscribes a superseded preference GET through the real transport", fakeAsync(() => {
    const component = settings();
    const old = http.expectOne("/api/v1/notifications/preferences");
    void component.loadNotificationPreferences();
    const current = http.expectOne("/api/v1/notifications/preferences");
    expect(old.cancelled).toBeTrue();
    flushMicrotasks();
    expect(component.notificationPrefsLoading()).toBeTrue();
    expect(component.notificationPrefsError()).toBeNull();
    current.flush({ preferences: [preference] });
    flushMicrotasks();
    expect(component.notificationPreferences()).toEqual([preference]);
    expect(component.notificationPrefsLoading()).toBeFalse();
  }));

  it("leaves a dispatched PATCH running after view destruction without publishing its result", fakeAsync(() => {
    const component = settings();
    http.expectOne("/api/v1/notifications/preferences").flush({ preferences: [preference] });
    flushMicrotasks();
    void component.setNotificationDelivery(preference, "disabled");
    flushMicrotasks();
    const write = http.expectOne("/api/v1/notifications/preferences");
    TestBed.resetTestingModule();
    expect(write.cancelled).toBeFalse();
    write.flush({ preferences: [{ ...preference, delivery: "disabled" }] });
    flushMicrotasks();
    expect(component.notificationPreferences()).toEqual([]);
    expect(snackbar.open).not.toHaveBeenCalled();
  }));

  it("continues rejecting a preference whose category contradicts the catalogue", fakeAsync(() => {
    const component = settings();
    http.expectOne("/api/v1/notifications/preferences").flush({ preferences: [{ ...preference, category: "mandatory" }] });
    flushMicrotasks();
    expect(component.notificationPreferences()).toEqual([]);
    expect(component.notificationPrefsError()).toContain("No se pudieron cargar");
    expect(auth.user()?.id).toBe(1);
  }));
});
