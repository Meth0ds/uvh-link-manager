import {
  decodeNotificationInbox,
  decodeNotificationPreferences,
  decodeNotificationUnread,
} from "./notification-response-decoders";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe("notification response decoders", () => {
  it("decodes an inbox page and its cursor", () => {
    const page = decodeNotificationInbox({ notifications: [row()], unread: 1, nextCursor: 9 });
    expect(page.notifications).toEqual([{
      id: 1,
      kind: "password_changed",
      subject: null,
      workspaceId: null,
      route: "/app/settings",
      createdAt: "2026-09-25T10:00:00.000Z",
      readAt: null,
    }]);
    expect(page.unread).toBe(1);
    expect(page.nextCursor).toBe(9);
    expect(decodeNotificationInbox({ notifications: [], unread: 0, nextCursor: null }).nextCursor).toBeNull();
  });

  it("keeps the server page bound and rejects unknown kinds", () => {
    expect(() => decodeNotificationInbox({
      notifications: Array.from({ length: 21 }, (_, id) => row({ id: id + 1 })), unread: 21, nextCursor: null,
    })).toThrow();
    expect(() => decodeNotificationInbox({ notifications: [row({ kind: "password_retyped" })], unread: 1, nextCursor: null })).toThrow();
    expect(() => decodeNotificationUnread({ unread: -1 })).toThrow();
    expect(decodeNotificationUnread({ unread: 0 })).toEqual({ unread: 0 });
  });

  it("only accepts internal panel routes and parseable timestamps", () => {
    expect(() => decodeNotificationInbox({ notifications: [row({ route: "https://evil.example/app" })], unread: 1, nextCursor: null })).toThrow();
    expect(() => decodeNotificationInbox({ notifications: [row({ route: "/app/settings?token=abc" })], unread: 1, nextCursor: null })).toThrow();
    expect(() => decodeNotificationInbox({ notifications: [row({ createdAt: "ayer" })], unread: 1, nextCursor: null })).toThrow();
    expect(decodeNotificationInbox({ notifications: [row({ route: null, subject: "tok-1", readAt: "2026-09-25T11:00:00.000Z" })], unread: 0, nextCursor: null }).notifications[0].subject).toBe("tok-1");
  });

  it("cross-checks every preference against the local catalog", () => {
    const decoded = decodeNotificationPreferences({ preferences: [
      { kind: "password_changed", category: "mandatory", delivery: "immediate" },
      { kind: "api_token_created", category: "operational", delivery: "daily_digest" },
    ] });
    expect(decoded.preferences.map((p) => p.delivery)).toEqual(["immediate", "daily_digest"]);

    // Una categoría que no cuadra con el espejo local es deriva entre backend y
    // frontend: se rechaza, no se presenta.
    expect(() => decodeNotificationPreferences({ preferences: [
      { kind: "api_token_created", category: "mandatory", delivery: "immediate" },
    ] })).toThrow();
    expect(() => decodeNotificationPreferences({ preferences: [
      { kind: "api_token_created", category: "operational", delivery: "por_búzón" },
    ] })).toThrow();
    expect(() => decodeNotificationPreferences({ preferences: [
      { kind: "ghost_kind", category: "operational", delivery: "disabled" },
    ] })).toThrow();
  });
});
