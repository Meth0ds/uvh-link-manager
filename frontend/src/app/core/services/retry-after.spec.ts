import { retryAfterSeconds } from "./retry-after";

describe("retryAfterSeconds", () => {
  const now = Date.parse("Sat, 05 Sep 2026 12:00:00 GMT");

  it("preserves integer seconds including zero and day-long quotas", () => {
    expect(retryAfterSeconds(" 60 ", now)).toBe(60);
    expect(retryAfterSeconds("0", now)).toBe(0);
    expect(retryAfterSeconds("86400", now)).toBe(86400);
  });

  it("rounds a future HTTP date up and expires a past date", () => {
    expect(retryAfterSeconds("Sat, 05 Sep 2026 12:01:00 GMT", now + 500)).toBe(60);
    expect(retryAfterSeconds("Sat, 05 Sep 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("does not turn malformed values into a fabricated delay", () => {
    for (const value of [null, "", " ", "-1", "+1", "1.5", "1e3", "Infinity", "60, 120", "tomorrow",
      "Tue, 31 Feb 2026 12:00:00 GMT", "Sun, 05 Sep 2026 12:00:00 GMT"]) {
      expect(retryAfterSeconds(value, now)).withContext(String(value)).toBeUndefined();
    }
  });

  it("rejects integer and deadline overflow", () => {
    expect(retryAfterSeconds("999999999999999999999999", now)).toBeUndefined();
    expect(retryAfterSeconds(String(Number.MAX_SAFE_INTEGER), now)).toBeUndefined();
  });
});
