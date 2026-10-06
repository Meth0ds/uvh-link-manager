import { sessionAgentLabel } from "./session-agent-label";

describe("Human session agent labels", () => {
  it("recognizes browser brands before their shared Chromium markers", () => {
    expect(sessionAgentLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537 Edg/140")).toBe("Edge en Windows");
    expect(sessionAgentLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537 OPR/120")).toBe("Opera en Windows");
  });
  it("recognizes mobile browsers without mistaking Android for Linux", () => {
    expect(sessionAgentLabel("Mozilla/5.0 (Linux; Android 14) Chrome/140 Safari/537")).toBe("Chrome en Android");
    expect(sessionAgentLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/130 Mobile Safari/605")).toBe("Firefox en iOS");
    expect(sessionAgentLabel("Mozilla/5.0 (iPad) Version/18.0 Mobile Safari/605")).toBe("Safari en iOS");
  });
  it("keeps platform and browser fallbacks useful when only one is known", () => {
    expect(sessionAgentLabel("Mozilla/5.0 (X11; CrOS x86_64) Chrome/140 Safari/537")).toBe("Chrome en ChromeOS");
    expect(sessionAgentLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18 Safari/605")).toBe("Safari en macOS");
    expect(sessionAgentLabel("Firefox/130")).toBe("Firefox");
    expect(sessionAgentLabel("Linux" )).toBe("Linux");
  });
  it("does not present unknown or missing text as a verified device name", () => {
    for (const value of [null, "", "   ", "arbitrary user text <script>"]) expect(sessionAgentLabel(value)).toBe("Dispositivo no identificado");
  });
});
