import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnInit, Output, QueryList, ViewChildren, afterNextRender, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

/**
 * Six individual boxes for a one-time code. The control stays the single owner
 * of the submitted value. Local slots preserve holes during editing; the
 * control receives their digits and stays invalid until all six are filled.
 * Parent writes/resets replace the slots, so neither can retain a stale code.
 *
 * Input contract: digits only, exactly 6; the first box answers to the label
 * "Código de autenticación" so the whole code can also be typed or pasted into
 * it (a paste spreads forward across the boxes).
 */
@Component({
  selector: "app-otp-code-input",
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="otp-code" role="group">
      @for (box of boxes(); track $index) {
        <input
          #boxInput
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="1"
          [value]="box"
          [disabled]="disabled"
          [attr.aria-label]="$index === 0 ? 'Código de autenticación' : 'Dígito ' + ($index + 1) + ' de 6'"
          (input)="onInput($event, $index)"
          (keydown)="onKeydown($event, $index)"
          (paste)="onPaste($event, $index)"
          (focus)="$any($event.target).select()" />
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .otp-code { display: flex; gap: 10px; justify-content: center; }
    .otp-code input {
      width: 52px; height: 62px; text-align: center;
      font: 700 22px "Courier New", monospace; letter-spacing: 0;
      color: var(--ink); background: var(--paper, #fff);
      border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
      border-radius: 4px; caret-color: var(--accent);
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }
    .otp-code input:focus {
      outline: none; border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .otp-code input:disabled { opacity: .55; }
    @media (max-width: 420px) {
      .otp-code { gap: 6px; }
      .otp-code input { width: 44px; height: 54px; font-size: 19px; }
    }
  `],
})
export class OtpCodeInputComponent implements OnInit {
  @Input({ required: true }) control!: FormControl<string | null>;
  @Input() disabled = false;
  /** Fires exactly once each time the sixth digit lands. */
  @Output() readonly completed = new EventEmitter<void>();

  @ViewChildren("boxInput") private inputs?: QueryList<{ nativeElement: HTMLInputElement }>;

  // Inputs are not set until after construction, so the mirror starts empty
  // and attaches to the control in ngOnInit, when it exists.
  protected readonly boxes = signal<readonly string[]>(["", "", "", "", "", ""]);
  private readonly destroyRef = inject(DestroyRef);
  private writingControl = false;
  // Completion is keyed by the code itself: retyping over a full code (the
  // retry-after-error case) must fire again, but the same code twice must not.
  private lastEmittedCode: string | null = null;

  constructor() {
    afterNextRender(() => this.focusBox(0));
  }

  ngOnInit(): void {
    this.projectControl(this.control.value);
    this.control.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!this.writingControl) this.projectControl(value);
      });
  }

  onInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const typed = input.value.replace(/\D/g, "");
    if (typed === "") {
      // Backspace/Delete landed here as an input event: clear this box only.
      this.writeDigits(index, "", index);
      return;
    }
    // Typed over a selected box (or autofilled): digits spread forward.
    this.writeDigits(index, typed, Math.min(index + typed.length, 5));
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === "Backspace" && input.value === "" && index > 0) {
      // Empty box: backspace walks left and clears the previous digit, the way
      // every authenticator code field behaves.
      event.preventDefault();
      this.writeDigits(index - 1, "", index - 1);
      return;
    }
    const jump: Record<string, number> = {
      ArrowLeft: Math.max(index - 1, 0),
      ArrowRight: Math.min(index + 1, 5),
      Home: 0,
      End: 5,
    };
    const target = jump[event.key];
    if (target === undefined) return;
    event.preventDefault();
    this.focusBox(target);
  }

  onPaste(event: ClipboardEvent, index: number): void {
    event.preventDefault();
    const fill = (event.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, 6 - index);
    if (fill === "") return;
    this.writeDigits(index, fill, Math.min(index + fill.length, 5));
  }

  /** Writes `text` starting at `start`, replacing from there; moves focus to `focusIndex`. */
  private writeDigits(start: number, text: string, focusIndex: number): void {
    const next = [...this.boxes()];
    if (text === "") next[start] = "";
    for (let offset = 0; offset < Math.min(text.length, 6 - start); offset += 1) {
      next[start + offset] = text[offset] ?? "";
    }
    const code = next.join("");
    const nowComplete = next.every((digit) => digit !== "");
    this.boxes.set(next);
    if (this.control.value !== code) {
      // Our own synchronous valueChanges emission must not compact the holes.
      this.writingControl = true;
      try {
        this.control.setValue(code);
      } finally {
        this.writingControl = false;
      }
    }
    if (!nowComplete) this.lastEmittedCode = null;
    // Completion can disable/destroy the boxes and move focus in the parent.
    // Finish local editing before handing control to that transition.
    this.focusBox(focusIndex);
    if (nowComplete && this.lastEmittedCode !== code) {
      this.lastEmittedCode = code;
      this.completed.emit();
    }
  }

  private projectControl(value: string | null): void {
    const digits = (value ?? "").replace(/\D/g, "").slice(0, 6);
    this.boxes.set([0, 1, 2, 3, 4, 5].map(index => digits[index] ?? ""));
    this.lastEmittedCode = null;
  }

  private focusBox(index: number): void {
    this.inputs?.get(index)?.nativeElement.focus();
  }
}
