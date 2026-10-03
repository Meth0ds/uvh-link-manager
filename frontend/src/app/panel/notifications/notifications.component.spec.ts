import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AuthUser, NotificationItem, NotificationPreference } from "../../core/models";
import { NotificationService } from "../../core/services/notification.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { Router } from "@angular/router";
import { NotificationsComponent } from "./notifications.component";

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    kind: "password_changed",
    subject: null,
    workspaceId: null,
    route: "/app/settings",
    createdAt: "2026-09-25T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

describe("NotificationsComponent", () => {
  type NotificationMethods = Pick<NotificationService, "list" | "markRead" | "markAllRead" | "refreshUnread" | "preferences" | "updatePreferences">;
  let notifications: jasmine.SpyObj<NotificationMethods> & { unread: ReturnType<typeof signal<number>> };
  let component: NotificationsComponent;
  let generation: number;
  let user: ReturnType<typeof signal<AuthUser | null>>;

  beforeEach(async () => {
    generation = 0;
    user = signal<AuthUser | null>({ id: 1, name: "A", email: "a@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false });
    const spy = jasmine.createSpyObj<NotificationMethods>(
      "NotificationService", ["list", "markRead", "markAllRead", "refreshUnread", "preferences", "updatePreferences"]);
    notifications = Object.assign(spy, { unread: signal(0) });
    // El doble imita al servicio real: la lista y las lecturas mueven el
    // contador compartido que la campana del panel observa.
    notifications.list.and.callFake(async () => {
      const page = { notifications: [item()], unread: 1, nextCursor: null };
      notifications.unread.set(page.unread);
      return page;
    });
    notifications.markRead.and.callFake(async () => {
      notifications.unread.set(0);
      return 0;
    });
    notifications.markAllRead.and.callFake(async () => {
      notifications.unread.set(0);
      return 0;
    });
    notifications.preferences.and.resolveTo([] as NotificationPreference[]);
    notifications.updatePreferences.and.resolveTo([] as NotificationPreference[]);
    notifications.refreshUnread.and.resolveTo(0);

    TestBed.configureTestingModule({
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: { sessionGeneration: () => generation, user } },
        { provide: WorkspaceService, useValue: { list: signal([{ id: 2 }]), select: jasmine.createSpy("select") } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new NotificationsComponent());
    await Promise.resolve();
    await Promise.resolve();
    notifications.list.calls.reset();
  });

  it("loads the first page and keeps the shared unread counter", async () => {
    await component.load();
    expect(component.items().map((row) => row.id)).toEqual([1]);
    expect(component.hasMore()).toBeFalse();
    expect(component.unread).toBe(notifications.unread);
    expect(component.unread()).toBe(1);
  });

  it("marks one row and the whole inbox without refetching", async () => {
    await component.load();
    await component.markRead(component.items()[0]);
    expect(notifications.markRead).toHaveBeenCalledOnceWith(1);
    expect(component.items()[0].readAt).not.toBeNull();
    expect(notifications.unread()).toBe(0);

    await component.markAllRead();
    expect(notifications.markAllRead).toHaveBeenCalled();
    expect(component.items().every((row) => row.readAt !== null)).toBeTrue();
  });

  it("appends the next page behind the cursor", async () => {
    notifications.list.and.callFake(async (before?: number | null) => {
      const page = before
        ? { notifications: [item({ id: 1 })], unread: 0, nextCursor: null }
        : { notifications: [item({ id: 2 })], unread: 0, nextCursor: 1 };
      notifications.unread.set(page.unread);
      return page;
    });
    await component.load();
    expect(component.hasMore()).toBeTrue();
    notifications.list.calls.reset();

    await component.loadMore();
    expect(notifications.list).toHaveBeenCalledOnceWith(1, jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(component.items().map((row) => row.id)).toEqual([2, 1]);
    expect(component.hasMore()).toBeFalse();
  });

  it("reports a failed load without disguising it as an empty inbox", async () => {
    await component.load();
    notifications.list.and.rejectWith(new Error("offline"));
    await component.load();
    expect(component.error()).toContain("No se pudieron cargar");
    // El fallo conserva la última página buena y no se presenta como «no tienes
    // notificaciones»: eso sólo se dice cuando la bandeja vuelve vacía y sin error.
    expect(component.items().map((row) => row.id)).toEqual([1]);
  });
  it("clears a previous operation error when a retry succeeds", async () => {
    component.error.set("No se pudo marcar la notificación.");
    await component.markRead(item());
    expect(component.error()).toBeNull();
    component.error.set("No se pudo marcar la bandeja.");
    await component.markAllRead();
    expect(component.error()).toBeNull();
    component.cursor.set(1);
    component.error.set("No se pudo cargar la siguiente página.");
    await component.loadMore();
    expect(component.error()).toBeNull();
  });

  it("prevents read mutations and pagination while the inbox is refreshing", async () => {
    component.loading.set(true);
    component.cursor.set(1);
    await component.markRead(item());
    await component.markAllRead();
    await component.loadMore();
    expect(notifications.markRead).not.toHaveBeenCalled();
    expect(notifications.markAllRead).not.toHaveBeenCalled();
    expect(notifications.list).not.toHaveBeenCalled();
  });

  it("opens the notification workspace and refuses a workspace no longer accessible", async () => {
    await component.openDetail(item({ workspaceId: 2, route: "/app/team" }));
    expect(TestBed.inject(WorkspaceService).select).toHaveBeenCalledWith(2);
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith("/app/team");
    const router = TestBed.inject(Router).navigateByUrl as jasmine.Spy;
    router.calls.reset();
    await component.openDetail(item({ workspaceId: 3 }));
    expect(router).not.toHaveBeenCalled();
    expect(component.error()).toContain("Ya no tienes acceso");
  });

  it("discards an older load after a newer page is displayed", async () => {
    let resolve!: (page: { notifications: NotificationItem[]; unread: number; nextCursor: null }) => void;
    notifications.list.and.returnValues(new Promise((done) => { resolve = done; }),
      Promise.resolve({ notifications: [item({ id: 2 })], unread: 1, nextCursor: null }));
    const old = component.load();
    await component.load();
    resolve({ notifications: [item({ id: 1 })], unread: 1, nextCursor: null });
    await old;
    expect(component.items().map((row) => row.id)).toEqual([2]);
  });

  it("removes the old inbox, cursor and error when the identity signs out", () => {
    TestBed.tick();
    component.cursor.set(2);
    component.error.set("old error");
    generation++;
    user.set(null);
    TestBed.tick();
    expect(component.items()).toEqual([]);
    expect(component.cursor()).toBeNull();
    expect(component.error()).toBeNull();
    expect(component.loading()).toBeFalse();
    expect(component.busy()).toBeFalse();
  });

  for (const action of ["page", "mark", "all"] as const) {
    it(`releases the old ${action} operation and preserves the new account's pending load`, async () => {
      TestBed.tick();
      let finish!: () => void;
      const old = new Promise<void>((resolve) => { finish = resolve; });
      component.cursor.set(2);
      notifications.list.and.returnValue(old.then(() => ({ notifications: [item()], unread: 1, nextCursor: null })));
      notifications.markRead.and.returnValue(old.then(() => 0));
      notifications.markAllRead.and.returnValue(old.then(() => 0));
      const pending = action === "page" ? component.loadMore()
        : action === "mark" ? component.markRead(item()) : component.markAllRead();
      let finishNew!: () => void;
      const fresh = new Promise<void>((resolve) => { finishNew = resolve; });
      notifications.list.and.returnValue(fresh.then(() => ({ notifications: [item({ id: 7 })], unread: 1, nextCursor: null })));
      generation++;
      user.set({ ...user()!, id: 2 });
      TestBed.tick();
      expect(component.busy()).toBeFalse();
      expect(component.items()).toEqual([]);
      expect(component.loading()).toBeTrue();
      finish();
      await pending;
      expect(component.loading()).toBeTrue();
      expect(component.items()).toEqual([]);
      finishNew();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(component.items().map((row) => row.id)).toEqual([7]);
      expect(component.loading()).toBeFalse();
    });
  }

});
