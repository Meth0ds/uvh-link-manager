import { WorkspaceService } from "./workspace.service";

const STORAGE_KEY = "uvh.workspaceId";

describe("WorkspaceService", () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it("does not restore malformed or unsafe authorization-context IDs", () => {
    for (const id of ["1.5", "-1", "Infinity", "9007199254740992"]) {
      localStorage.setItem(STORAGE_KEY, id);
      expect(new WorkspaceService().currentId()).withContext(id).toBeNull();
    }
  });

  it("normalizes invalid programmatic selections to no workspace", () => {
    const service = new WorkspaceService();
    for (const id of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      service.select(id);
      expect(service.currentId()).withContext(String(id)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    }
  });

  it("preserves a valid positive safe integer", () => {
    const service = new WorkspaceService();
    service.select(42);
    expect(service.currentId()).toBe(42);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("42");
  });
});
