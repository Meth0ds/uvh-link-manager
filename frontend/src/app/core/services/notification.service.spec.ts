import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { NotificationService } from "./notification.service";

describe("NotificationService response ownership", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: NotificationService;
  let generation: number;
  const authenticated = signal(true);
  const user = signal({ id: 1 });
  beforeEach(() => {
    generation = 0;
    authenticated.set(true);
    user.set({ id: 1 });
    api = jasmine.createSpyObj<ApiService>("api", ["get", "post"]);
    TestBed.configureTestingModule({ providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { authenticated, user, sessionGeneration: () => generation } },
    ] });
    service = TestBed.inject(NotificationService);
  });

  it("does not resurrect unread after mark-all from a delayed read", async () => {
    let resolve!: (value: { unread: number }) => void;
    api.get.and.returnValue(new Promise((done) => { resolve = done; }));
    api.post.and.resolveTo({ unread: 0 });
    const old = service.refreshUnread();
    await service.markAllRead();
    resolve({ unread: 4 });
    await old;
    expect(service.unread()).toBe(0);
  });

  it("never executes a queued write using a replacement account's cookie", async () => {
    let resolve!: (value: { unread: number }) => void;
    api.post.and.returnValue(new Promise((done) => { resolve = done; }));
    const first = service.markRead(1);
    const queued = service.markAllRead().catch((error: unknown) => error);
    await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(1);
    generation++;
    authenticated.set(false);
    authenticated.set(true);
    api.get.and.resolveTo({ unread: 3 });
    await service.refreshUnread();
    resolve({ unread: 0 });
    await first;
    expect(await queued).toEqual(jasmine.any(Error));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(service.unread()).toBe(3);
  });

  it("clears a cached counter when identity changes while authenticated stays true", async () => {
    api.get.and.resolveTo({ unread: 4 });
    await service.refreshUnread();
    expect(service.unread()).toBe(4);
    generation++;
    user.set({ id: 2 });
    expect(authenticated()).toBeTrue();
    expect(service.unread()).toBe(0);
  });

  it("clears counts on logout and rejects another session's response", async () => {
    api.get.and.resolveTo({ unread: 4 });
    await service.refreshUnread();
    expect(service.unread()).toBe(4);
    let resolve!: (value: { unread: number }) => void;
    api.get.and.returnValue(new Promise((done) => { resolve = done; }));
    const old = service.refreshUnread();
    generation++;
    authenticated.set(false);
    expect(service.unread()).toBe(0);
    authenticated.set(true);
    resolve({ unread: 9 });
    await old;
    expect(service.unread()).toBe(0);
  });
});
