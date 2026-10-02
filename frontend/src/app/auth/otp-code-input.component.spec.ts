import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormControl, Validators } from "@angular/forms";
import { OtpCodeInputComponent } from "./otp-code-input.component";

describe("OTP editing and completion lifecycle", () => {
  let fixture: ComponentFixture<OtpCodeInputComponent>;
  let control: FormControl<string | null>;
  let completed: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OtpCodeInputComponent] });
    fixture = TestBed.createComponent(OtpCodeInputComponent);
    control = new FormControl<string | null>("", [Validators.required, Validators.pattern(/^\d{6}$/)]);
    fixture.componentRef.setInput("control", control);
    completed = jasmine.createSpy("completed");
    fixture.componentInstance.completed.subscribe(completed);
    fixture.detectChanges();
  });

  const inputs = (): HTMLInputElement[] => Array.from(fixture.nativeElement.querySelectorAll("input"));
  const digits = (): string[] => inputs().map(input => input.value);

  function type(index: number, value: string): void {
    const input = inputs()[index];
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
  }

  function paste(index: number, value: string): void {
    const clipboard = new DataTransfer();
    clipboard.setData("text", value);
    inputs()[index].dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it("clears a middle digit without retaining a valid stale code or shifting the other boxes", () => {
    control.setValue("123456");
    fixture.detectChanges();
    type(2, "");
    expect(control.valid).toBeFalse();
    expect(control.value).not.toBe("123456");
    expect(digits()).toEqual(["1", "2", "", "4", "5", "6"]);
    expect(completed).not.toHaveBeenCalled();
    type(2, "9");
    expect(control.value).toBe("129456");
    expect(digits()).toEqual(["1", "2", "9", "4", "5", "6"]);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("Backspace on an empty box clears the previous digit and invalidates the form", () => {
    type(0, "1");
    type(1, "2");
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    inputs()[2].dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBeTrue();
    expect(control.value).toBe("1");
    expect(digits()).toEqual(["1", "", "", "", "", ""]);
    expect(document.activeElement).toBe(inputs()[1]);
  });

  it("retains an out-of-order digit in its own box until the missing positions are filled", () => {
    type(4, "5");
    expect(digits()).toEqual(["", "", "", "", "5", ""]);
    expect(control.invalid).toBeTrue();
    type(0, "1");
    type(1, "2");
    type(2, "3");
    type(3, "4");
    type(5, "6");
    expect(control.value).toBe("123456");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("allows the same complete code after the parent resets the challenge", () => {
    paste(0, "123456");
    expect(completed).toHaveBeenCalledTimes(1);
    control.reset();
    fixture.detectChanges();
    expect(digits()).toEqual(["", "", "", "", "", ""]);
    paste(0, "123456");
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it("allows the same complete code after an intentional erase and refill", () => {
    paste(0, "123456");
    type(5, "");
    expect(control.invalid).toBeTrue();
    type(5, "6");
    expect(control.value).toBe("123456");
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it("spreads a paste forward, sanitizes it and does not resubmit an unchanged complete code", () => {
    paste(0, "12 34-56 extra");
    expect(control.value).toBe("123456");
    expect(digits()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(completed).toHaveBeenCalledTimes(1);
    paste(0, "123456");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("truncates an autofill to six boxes instead of extending the submitted value", () => {
    type(0, "123456789");
    expect(control.value).toBe("123456");
    expect(control.valid).toBeTrue();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("projects an explicit parent value after partial positional editing", () => {
    type(4, "5");
    control.setValue("12");
    fixture.detectChanges();
    expect(digits()).toEqual(["1", "2", "", "", "", ""]);
    expect(control.invalid).toBeTrue();
    expect(completed).not.toHaveBeenCalled();
  });
});
