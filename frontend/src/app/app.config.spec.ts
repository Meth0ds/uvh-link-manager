import { routes } from "./app.config";

describe("application routes", () => {
  it("registers the public and authenticated route surfaces", () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toEqual([
      "",
      "auth",
      "legal",
      "invitations/accept",
      "forbidden",
      "not-found",
      "app",
      "**",
    ]);
  });

  it("keeps the catch-all route last", () => {
    expect(routes.at(-1)?.path).toBe("**");
    expect(routes.find((route) => route.path === "app")?.loadChildren).toBeDefined();
  });
});
