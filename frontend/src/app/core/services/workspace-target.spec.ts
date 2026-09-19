import type { WorkspaceService } from "./workspace.service";
import { targetWorkspace } from "./workspace-target";

class FakeWorkspaces {
  private selected: number | null;

  constructor(selected: number | null) {
    this.selected = selected;
  }

  currentId(): number | null {
    return this.selected;
  }

  select(id: number | null): void {
    this.selected = id;
  }
}

function workspaces(selected: number | null): FakeWorkspaces & WorkspaceService {
  return new FakeWorkspaces(selected) as unknown as FakeWorkspaces & WorkspaceService;
}

describe("targetWorkspace", () => {
  it("stops matching once another workspace is selected", () => {
    const service = workspaces(7);
    const target = targetWorkspace(service);

    expect(target.workspaceId).toBe(7);
    expect(target.isCurrent()).toBeTrue();

    service.select(8);
    expect(target.isCurrent()).toBeFalse();

    service.select(null);
    expect(target.isCurrent()).toBeFalse();
  });

  it("matches again if the original workspace is selected back", () => {
    const service = workspaces(7);
    const target = targetWorkspace(service);

    service.select(8);
    service.select(7);

    // The decision still names workspace 7, which is the selected tenant again:
    // there is nothing to protect against any more.
    expect(target.isCurrent()).toBeTrue();
  });

  it("keeps the captured id instead of following the selection", () => {
    const service = workspaces(7);
    const target = targetWorkspace(service);

    service.select(8);

    expect(target.workspaceId).toBe(7);
  });

  it("never matches a decision that named no workspace", () => {
    const service = workspaces(null);
    const target = targetWorkspace(service);

    expect(target.workspaceId).toBeNull();
    expect(target.isCurrent()).toBeFalse();

    service.select(3);
    expect(target.isCurrent()).toBeFalse();
  });

  it("prefers the workspace that owns the data over the selection", () => {
    const service = workspaces(8);
    // A row read from workspace 7, clicked while the header already moved on:
    // the decision names 7, and 7 is not the selected tenant, so it is refused.
    const target = targetWorkspace(service, 7);

    expect(target.workspaceId).toBe(7);
    expect(target.isCurrent()).toBeFalse();
  });

  it("never matches when the caller reports no owning workspace", () => {
    const service = workspaces(8);
    const target = targetWorkspace(service, null);

    expect(target.workspaceId).toBeNull();
    expect(target.isCurrent()).toBeFalse();
  });
});
