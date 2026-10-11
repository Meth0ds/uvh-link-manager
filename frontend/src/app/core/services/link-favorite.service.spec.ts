import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { LinkDto } from "../models";
import { ApiService } from "./api.service";
import { LinkWorkflowService } from "./link-workflow.service";
import { LinkFavoriteService } from "./link-favorite.service";

describe("LinkFavoriteService personal mutations", () => {
  let api: jasmine.SpyObj<ApiService>, service: LinkFavoriteService;
  const context = signal("workspace:1:user:1"), enabled = signal(true);
  const link = (favorite = false) => ({ id: 7, favorite } as LinkDto);
  const flush = async () => { await new Promise<void>(done => setTimeout(done, 0)); };
  const pending = () => { let resolve!: (value: { favorite: boolean }) => void, reject!: (error: Error) => void; const promise = new Promise<{ favorite: boolean }>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

  beforeEach(async () => {
    context.set("workspace:1:user:1"); enabled.set(true);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["patch"]);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: LinkWorkflowService, useValue: { context, enabled } }] });
    service = TestBed.inject(LinkFavoriteService); await flush();
  });

  it("updates the star immediately and coalesces rapid clicks into the last desired state", async () => {
    const first = pending(), second = pending(); api.patch.and.returnValues(first.promise as never, second.promise as never);
    service.toggle(link()); expect(service.value(link())).toBeTrue(); expect(service.pending().has(7)).toBeTrue();
    service.toggle(link()); expect(service.value(link())).toBeFalse(); expect(api.patch).toHaveBeenCalledTimes(1);
    first.resolve({ favorite: true }); await flush();
    expect(api.patch).toHaveBeenCalledTimes(2); expect(api.patch.calls.mostRecent().args[1]).toEqual({ favorite: false });
    second.resolve({ favorite: false }); await flush();
    expect(service.value(link())).toBeFalse(); expect(service.pending().size).toBe(0); expect(service.error()).toBeNull();
  });

  it("does not send an intermediate click that ends at the confirmed value", async () => {
    const first = pending(); api.patch.and.returnValue(first.promise as never);
    service.toggle(link()); service.toggle(link()); service.toggle(link());
    first.resolve({ favorite: true }); await flush();
    expect(api.patch).toHaveBeenCalledTimes(1); expect(service.value(link())).toBeTrue();
  });

  it("rolls back to the last confirmed value after a failed follow-up mutation", async () => {
    const first = pending(), second = pending(); api.patch.and.returnValues(first.promise as never, second.promise as never);
    service.toggle(link()); service.toggle(link()); first.resolve({ favorite: true }); await flush();
    second.reject(new Error("Network failed")); await flush();
    expect(service.value(link())).toBeTrue(); expect(service.pending().size).toBe(0); expect(service.error()).toContain("Vuelve a intentarlo");
  });

  it("ignores a late reply after switching workspace, even before its cleanup effect", async () => {
    const first = pending(); api.patch.and.returnValue(first.promise as never);
    service.toggle(link()); context.set("workspace:2:user:1"); first.resolve({ favorite: true }); await flush();
    expect(service.values().size).toBe(0); expect(service.pending().size).toBe(0); expect(service.error()).toBeNull();
  });

  it("stops coalesced mutations when workflow activation is withdrawn", async () => {
    const first = pending(); api.patch.and.returnValue(first.promise as never);
    service.toggle(link()); service.toggle(link()); enabled.set(false); first.resolve({ favorite: true }); await flush();
    expect(api.patch).toHaveBeenCalledTimes(1); expect(service.pending().size).toBe(0);
  });

  it("refuses a new favorite while disabled and rolls back mismatching server results", async () => {
    enabled.set(false); service.toggle(link()); expect(api.patch).not.toHaveBeenCalled();
    enabled.set(true); api.patch.and.resolveTo({ favorite: false } as never); service.toggle(link()); await flush();
    expect(service.value(link())).toBeFalse(); expect(service.error()).not.toBeNull();
  });
  it("starts a new intent after a context change without waiting for effect cleanup", async () => {
    const old = pending(); api.patch.and.returnValues(old.promise as never, Promise.resolve({ favorite: true }) as never);
    service.toggle(link()); context.set("workspace:2:user:2");
    service.toggle(link()); await flush(); old.resolve({ favorite: true }); await flush();
    expect(api.patch).toHaveBeenCalledTimes(2); expect(service.value(link())).toBeTrue();
    expect(service.pending().size).toBe(0);
  });
});
