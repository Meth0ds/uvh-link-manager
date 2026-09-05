import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { PendingLinkIntentService } from "./pending-link-intent.service";

const TOKEN = "a".repeat(43);
const STORAGE_KEY = "uvh.pending-link-intent.v1";

describe("PendingLinkIntentService", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: PendingLinkIntentService;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(PendingLinkIntentService);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("stores only an opaque token and expiry on the app origin", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    expect(service.capture(TOKEN, expiresAt)).toBeTrue();
    expect(service.pending()).toEqual(jasmine.objectContaining({ intent: TOKEN, expiresAt }));
    expect(localStorage.getItem(STORAGE_KEY)).toContain(TOKEN);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("example.com");
  });

  it("rejects malformed or already expired handoff tokens", () => {
    expect(service.capture("not-a-token")).toBeFalse();
    expect(service.capture(TOKEN, new Date(Date.now() - 1_000).toISOString())).toBeFalse();
    expect(service.hasPending()).toBeFalse();
  });

  it("claims the destination only after a token is present", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    api.post.and.resolveTo({ destination: "https://example.com/campaign", expiresAt });
    service.capture(TOKEN, expiresAt);

    await expectAsync(service.claim()).toBeResolvedTo({ destination: "https://example.com/campaign", expiresAt });
    expect(api.post).toHaveBeenCalledWith("/api/v1/link-intents/claim", { intent: TOKEN });
  });
});
