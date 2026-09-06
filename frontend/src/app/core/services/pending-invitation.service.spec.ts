import { PendingInvitationService } from "./pending-invitation.service";

const TOKEN = "b".repeat(43);
const STORAGE_KEY = "uvh.pending-invitation.v1";

describe("PendingInvitationService", () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it("does not resurrect a bearer when Storage removal is partially denied", () => {
    const service = new PendingInvitationService();
    service.capture(TOKEN);
    const remove = spyOn(localStorage, "removeItem").and.throwError("Fixture: denied removal");

    service.clear();

    expect(service.token()).toBe("");
    expect(service.hasPending()).toBeFalse();
    remove.and.callThrough();
  });

  it("rejects array-coerced tokens from untrusted persisted JSON", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: [TOKEN], expiresAt: Date.now() + 60_000 }));
    const service = new PendingInvitationService();

    expect(service.token()).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("rejects persisted invitations that exceed the seven-day retention bound", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: TOKEN, expiresAt: Date.now() + 8 * 24 * 60 * 60 * 1000 }));
    const service = new PendingInvitationService();

    expect(service.token()).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("deletes malformed JSON instead of reparsing it on every read", () => {
    localStorage.setItem(STORAGE_KEY, "{broken");
    const service = new PendingInvitationService();

    expect(service.token()).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
