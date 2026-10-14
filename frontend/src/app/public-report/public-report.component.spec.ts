import { TestBed } from "@angular/core/testing";
import { DOCUMENT } from "@angular/common";
import { ActivatedRoute } from "@angular/router";
import { Meta } from "@angular/platform-browser";
import { ApiService } from "../core/services/api.service";
import { PublicReportComponent } from "./public-report.component";
describe("Public report capabilities", () => {
  let access: jasmine.Spy;
  let read: jasmine.Spy;
  let replace: jasmine.Spy;
  function component(): PublicReportComponent {
    return TestBed.runInInjectionContext(() => new PublicReportComponent());
  }
  beforeEach(() => {
    access = jasmine
      .createSpy("access")
      .and.resolveTo({ passwordRequired: true });
    read = jasmine.createSpy("get").and.rejectWith(new Error("fixture"));
    replace = jasmine.createSpy("replaceState");
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: { accessSharedReport: access, get: read },
        },
        {
          provide: Meta,
          useValue: {
            getTag: () => null,
            updateTag: () => undefined,
            removeTag: () => undefined,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => "12345678-1234-4234-8234-123456789012" },
            },
          },
        },
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: {
              location: {
                hash: "#token=" + "a".repeat(43),
                pathname: "/reports/12345678-1234-4234-8234-123456789012",
                search: "",
              },
              history: { state: null, replaceState: replace },
            },
            visibilityState: "hidden",
          },
        },
      ],
    });
  });
  it("strips the URL capability before exchanging it and keeps protected metadata hidden", async () => {
    const c = component();
    await Promise.resolve();
    await Promise.resolve();
    expect(replace).toHaveBeenCalled();
    expect(access.calls.mostRecent().args[1].token).toBe("a".repeat(43));
    expect(c.passwordRequired()).toBeTrue();
    expect(c.report()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("does not use an invalid preview token as an authorization", async () => {
    const document = TestBed.inject(DOCUMENT);
    document.defaultView!.location.hash = "#token=preview-only";
    const c = component();
    await Promise.resolve();
    expect(access).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(c.unavailable()).toBeTrue();
  });
  it("retries the capability exchange after a network failure without requiring the removed fragment", async () => {
    access.and.rejectWith(new Error("connection interrupted"));
    const c = component();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.error()).toBeTruthy();
    access.and.resolveTo({ passwordRequired: true });
    c.retry();
    await Promise.resolve();
    await Promise.resolve();
    expect(access).toHaveBeenCalledTimes(2);
    expect(access.calls.mostRecent().args[1].token).toBe("a".repeat(43));
    expect(c.passwordRequired()).toBeTrue();
    expect(read).not.toHaveBeenCalled();
  });
  it("does not render a late result after the view is destroyed", async () => {
    let resolve!: (v: { passwordRequired: boolean }) => void;
    access.and.returnValue(new Promise((r) => (resolve = r)));
    const c = component();
    TestBed.resetTestingModule();
    resolve({ passwordRequired: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(c.report()).toBeNull();
  });
});
