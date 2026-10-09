import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { CopyFeedbackService } from "./copy-feedback.service";
import { SessionContextService } from "./session-context.service";

describe("Clipboard feedback ownership", () => {
  let feedback: CopyFeedbackService;
  let session: SessionContextService;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let write: jasmine.Spy;
  let clipboardDescriptor: PropertyDescriptor | undefined;
  let scope: string;
  const context = () => scope;
  const url = "https://uvh.es/one";
  beforeEach(() => {
    scope = "workspace-1:revision-0";
    write = jasmine.createSpy("writeText").and.resolveTo(undefined);
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    snack = jasmine.createSpyObj<MatSnackBar>("snack", ["open"]);
    TestBed.configureTestingModule({ providers: [CopyFeedbackService, { provide: MatSnackBar, useValue: snack }] });
    feedback = TestBed.inject(CopyFeedbackService);
    session = TestBed.inject(SessionContextService);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  });
  it("waits for actual clipboard acknowledgement and resets transient confirmation", fakeAsync(() => {
    let resolve!: () => void;
    write.and.returnValue(new Promise<void>((done) => { resolve = done; }));
    feedback.copy(url, context);
    expect(write).toHaveBeenCalledOnceWith(url);
    expect(feedback.phase(url, context)).toBe("copying");
    expect(feedback.busy()).toBeTrue();
    expect(snack.open).not.toHaveBeenCalled();
    resolve(); flushMicrotasks();
    expect(feedback.phase(url, context)).toBe("copied");
    expect(feedback.busy()).toBeFalse();
    expect(snack.open).toHaveBeenCalledOnceWith("Enlace copiado", "Cerrar", { duration: 2000 });
    tick(2400); expect(feedback.phase(url, context)).toBe("idle");
  }));
  it("coalesces concurrent activation across controls in the same view", fakeAsync(() => {
    write.and.returnValue(new Promise<void>(() => { /* held browser prompt */ }));
    feedback.copy(url, context); feedback.copy(url, context); feedback.copy("https://uvh.es/two", context);
    expect(write).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule(); tick(20000);
  }));
  for (const failure of ["reject", "throw", "missing"] as const) {
    it(`keeps copy retryable on ${failure} without false success`, fakeAsync(() => {
      if (failure === "reject") write.and.rejectWith(new Error("Denied"));
      if (failure === "throw") write.and.throwError("Denied synchronously");
      if (failure === "missing") Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      feedback.copy(url, context); flushMicrotasks();
      expect(feedback.phase(url, context)).toBe("error");
      expect(snack.open.calls.mostRecent().args[0]).not.toBe("Enlace copiado");
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write.and.resolveTo(undefined) } });
      feedback.copy(url, context); flushMicrotasks();
      expect(feedback.phase(url, context)).toBe("copied"); tick(2400);
    }));
  }
  it("expires a hung permission prompt and ignores its eventual acknowledgement", fakeAsync(() => {
    let resolve!: () => void;
    write.and.returnValue(new Promise<void>((done) => { resolve = done; }));
    feedback.copy(url, context); tick(20000);
    expect(feedback.phase(url, context)).toBe("error");
    resolve(); flushMicrotasks(); expect(snack.open).toHaveBeenCalledTimes(1);
    expect(feedback.phase(url, context)).toBe("error"); tick(2400);
    expect(feedback.phase(url, context)).toBe("idle");
  }));
  for (const boundary of ["session", "workspace", "workspace-roundtrip", "destroy"] as const) {
    it(`discards a late result after ${boundary}`, fakeAsync(() => {
      let resolve!: () => void;
      write.and.returnValue(new Promise<void>((done) => { resolve = done; }));
      feedback.copy(url, context);
      if (boundary === "session") session.advance();
      if (boundary === "workspace") scope = "workspace-2:revision-1";
      if (boundary === "workspace-roundtrip") scope = "workspace-1:revision-2";
      if (boundary === "destroy") TestBed.resetTestingModule();
      expect(feedback.phase(url, context)).toBe("idle");
      resolve(); flushMicrotasks(); tick(22400);
      expect(snack.open).not.toHaveBeenCalled();
      expect(feedback.phase(url, context)).toBe("idle");
    }));
  }
  it("lets a new owner copy while the previous owner's promise remains unresolved", fakeAsync(() => {
    let resolveOld!: () => void;
    write.and.returnValues(new Promise<void>((done) => { resolveOld = done; }), Promise.resolve());
    feedback.copy(url, context); scope = "workspace-2:revision-1";
    feedback.copy(url, context); flushMicrotasks();
    expect(feedback.phase(url, context)).toBe("copied");
    resolveOld(); flushMicrotasks(); expect(snack.open).toHaveBeenCalledTimes(1); tick(2400);
  }));
});
