import { safeReturnTo } from "./auth.guard";

describe("safeReturnTo", () => {
  it("keeps internal application paths", () => {
    expect(safeReturnTo("/app/links?destination=https%3A%2F%2Fexample.com")).toBe(
      "/app/links?destination=https%3A%2F%2Fexample.com",
    );
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeReturnTo("https://attacker.example/login")).toBe("/app");
    expect(safeReturnTo("//attacker.example/login")).toBe("/app");
  });

  it("rejects backslashes and control characters", () => {
    expect(safeReturnTo("/\\\\attacker.example")).toBe("/app");
    expect(safeReturnTo("/app\u0000")).toBe("/app");
  });

  it("rejects unbounded values", () => {
    expect(safeReturnTo(`/app/${"x".repeat(1025)}`)).toBe("/app");
  });
});
