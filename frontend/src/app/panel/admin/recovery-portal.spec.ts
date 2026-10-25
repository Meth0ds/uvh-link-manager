import { DestroyRef, inject } from "@angular/core";
import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import { ApiService } from "../../core/services/api.service";
import { RecoveryAdminApi } from "./recovery-admin-api";
import { RecoveryPortal } from "./recovery-portal";

describe("RecoveryPortal", () => {
  let api: RecoveryAdminApi;
  let portal: RecoveryPortal;
  let destroy: DestroyRef;
  let popup: jasmine.SpyObj<Window>;
  let error: jasmine.Spy<(message: string) => void>;
  const ready = (source: Window, origin = window.location.origin) => {
    const event = new MessageEvent("message", { origin, data: { type: "uvh-recovery-ready" } });
    Object.defineProperty(event, "source", { value: source });
    window.dispatchEvent(event);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    destroy = TestBed.runInInjectionContext(() => inject(DestroyRef));
    api = new RecoveryAdminApi(jasmine.createSpyObj<ApiService>("api", ["post"]));
    portal = new RecoveryPortal(api, destroy);
    popup = jasmine.createSpyObj<Window>("popup", ["close", "postMessage"], { closed: false });
    spyOn(window, "open").and.returnValue(popup);
    error = jasmine.createSpy("error");
  });
  afterEach(() => TestBed.resetTestingModule());

  it("does not issue a ticket when the browser blocks the popup", async () => {
    (window.open as jasmine.Spy).and.returnValue(null);
    const access = spyOn(api, "access");
    expect(await portal.open("password", "factor", () => true, error)).toBeFalse();
    expect(access).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("delivers once only to the ready same-origin popup and leaves it open", fakeAsync(() => {
    spyOn(api, "access").and.resolveTo("one-use-ticket");
    void portal.open("password", "factor", () => !destroy.destroyed, error);
    ready(popup, "https://untrusted.invalid");
    ready(window);
    flushMicrotasks();
    expect(popup.postMessage).not.toHaveBeenCalled();
    ready(popup);
    flushMicrotasks();
    ready(popup);
    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    expect(popup.postMessage.calls.mostRecent().args[0]).toEqual({ type: "uvh-recovery-ticket", ticket: "one-use-ticket" });
    expect(String(popup.postMessage.calls.mostRecent().args[1])).toBe(window.location.origin);
    expect(popup.close).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    tick(10000);
  }));

  it("accepts readiness before the ticket arrives", fakeAsync(() => {
    spyOn(api, "access").and.resolveTo("one-use-ticket");
    void portal.open("password", "factor", () => true, error);
    ready(popup);
    flushMicrotasks();
    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
  }));

  it("times out without leaking the ticket or leaving a listener", fakeAsync(() => {
    spyOn(api, "access").and.resolveTo("one-use-ticket");
    void portal.open("password", "factor", () => true, error);
    flushMicrotasks();
    tick(10000);
    ready(popup);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.postMessage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  }));

  it("cleans an unfinished handshake when its view is destroyed", fakeAsync(() => {
    spyOn(api, "access").and.resolveTo("one-use-ticket");
    void portal.open("password", "factor", () => !destroy.destroyed, error);
    flushMicrotasks();
    TestBed.resetTestingModule();
    flushMicrotasks();
    ready(popup);
    tick(10000);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.postMessage).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  }));
});
