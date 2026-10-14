import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { ReportDialogComponent } from "./report-dialog.component";
import { SharingService } from "../../../core/services/sharing.service";
import { CopyFeedbackService } from "../../../core/services/copy-feedback.service";
import type { AnalyticsReport } from "../../../core/sharing";
describe("Report creation intent", () => {
  let context: string;
  let save: jasmine.Spy;
  let close: jasmine.Spy;
  const report: AnalyticsReport = {
    id: 1,
    publicId: "report",
    version: 1,
    spec: {
      version: 1,
      title: "Results",
      description: "",
      period: "30d",
      from: null,
      to: null,
      sections: ["visits"],
    },
    links: [{ linkId: 1, label: "Public" }],
    passwordProtected: false,
    expiresAt: null,
    state: "active",
    shareUrl: "https://app.example.test/reports/x#token=secret",
  };
  function component(): ReportDialogComponent {
    return TestBed.runInInjectionContext(() => new ReportDialogComponent());
  }
  beforeEach(() => {
    context = "one";
    save = jasmine.createSpy("save").and.resolveTo({ report });
    close = jasmine.createSpy("close");
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { initial: [{ linkId: 1, label: "alias" }] },
        },
        { provide: MatDialogRef, useValue: { close } },
        { provide: CopyFeedbackService, useValue: {} },
        {
          provide: SharingService,
          useValue: {
            context: () => context,
            canPublish: () => true,
            reportsEnabled: signal(true),
            save,
            api: { get: () => Promise.resolve({ links: [], total: 0 }) },
          },
        },
      ],
    });
  });
  it("starts with public aliases and explicit period and expiry", () => {
    const c = component();
    expect(c.spec.period).toBe("30d");
    expect(c.expiryEnabled).toBeTrue();
    expect(c.selection()[0].label).toBe("alias");
  });
  it("preserves an idempotency key after a failed identical submission", async () => {
    const c = component();
    c.spec.title = "Results";
    save.and.rejectWith(new Error("timeout"));
    await c.save();
    const key = save.calls.mostRecent().args[1];
    await c.save();
    expect(save.calls.mostRecent().args[1]).toBe(key);
    c.spec.title = "Changed";
    await c.save();
    expect(save.calls.mostRecent().args[1]).not.toBe(key);
  });
  it("does not update a stale dialog after workspace changed", async () => {
    let resolve!: (v: { report: AnalyticsReport }) => void;
    save.and.returnValue(new Promise((r) => (resolve = r)));
    const c = component();
    c.spec.title = "Results";
    const pending = c.save();
    context = "two";
    resolve({ report });
    await pending;
    expect(c.saved()).toBeNull();
  });
  it("clears the submitted password after successful save", async () => {
    const c = component();
    c.spec.title = "Results";
    c.passwordAction = "set";
    c.password = "Never retained";
    await c.save();
    expect(c.password).toBe("");
    expect(c.passwordAction).toBe("keep");
  });
  it("keeps selection when browsing and only changes an explicitly edited label", () => {
    const c = component();
    c.label(1, "Customer label");
    expect(c.selection()).toEqual([{ linkId: 1, label: "Customer label" }]);
    c.remove(1);
    expect(c.selection()).toEqual([]);
  });
});
