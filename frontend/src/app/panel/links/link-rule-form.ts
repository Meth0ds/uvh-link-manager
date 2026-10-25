import { FormBuilder, FormControl, FormGroup, Validators, type AbstractControl, type ValidationErrors } from "@angular/forms";
import type { RedirectRule } from "../../core/models";
import { localTimeToUtcTime, utcTimeToLocalTime } from "../../core/strict-wire";
import { unicodeMaxLength } from "../../core/unicode-validators";

export type RuleGroup = FormGroup<{
  priority: FormControl<number>;
  country: FormControl<string>;
  language: FormControl<string>;
  device: FormControl<string>;
  os: FormControl<string>;
  timeFrom: FormControl<string>;
  timeTo: FormControl<string>;
  referrer: FormControl<string>;
  campaign: FormControl<string>;
  destination: FormControl<string>;
}>;

export function httpUrlValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 2048) return { url: true };
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? null : { url: true };
  } catch {
    return { url: true };
  }
}

export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function noControlCharacters(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? "");
  return CONTROL_CHARACTERS.test(value) ? { controlCharacters: true } : null;
}

export function integerValidator(control: AbstractControl): ValidationErrors | null {
  return control.value == null || Number.isInteger(control.value) ? null : { integer: true };
}

export function createRuleForm(fb: FormBuilder, initial: Partial<RedirectRule>, index: number, timezone: string): RuleGroup {
  const raw = initial as RedirectRule & { time_from?: string | null; time_to?: string | null };
  return fb.nonNullable.group({
    priority: [initial.priority ?? index, [Validators.min(0), Validators.max(1000), integerValidator]],
    country: [initial.country ?? "", [Validators.pattern(/^[a-zA-Z]{2}$/)]],
    language: [initial.language ?? "", [Validators.maxLength(8), Validators.pattern(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?$/)]],
    device: [initial.device ?? ""],
    os: [initial.os ?? "", [unicodeMaxLength(40), noControlCharacters]],
    timeFrom: [utcTimeToLocalTime(initial.timeFrom ?? raw.time_from ?? "", timezone) ?? initial.timeFrom ?? raw.time_from ?? "", [Validators.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]],
    timeTo: [utcTimeToLocalTime(initial.timeTo ?? raw.time_to ?? "", timezone) ?? initial.timeTo ?? raw.time_to ?? "", [Validators.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]],
    referrer: [initial.referrer ?? "", [unicodeMaxLength(200), noControlCharacters]],
    campaign: [initial.campaign ?? "", [unicodeMaxLength(100), noControlCharacters]],
    // Empty means delete/omit the row. Non-empty destinations must still
    // satisfy exactly the same URL contract as the primary destination.
    destination: [initial.destination ?? "", [Validators.maxLength(2048), httpUrlValidator]],
  });
}

export function serializeRuleForms(controls: RuleGroup[], timezone: string): RedirectRule[] {
  const out: RedirectRule[] = [];
  controls.forEach((g, index) => {
    const v = g.value;
    const destination = v.destination?.trim();
    if (!destination) return;
    out.push({
      priority: v.priority ?? index,
      country: v.country?.trim() || null,
      language: v.language?.trim() || null,
      device: (v.device as "desktop" | "mobile" | "tablet" | null) || null,
      os: v.os?.trim() || null,
      timeFrom: v.timeFrom ? localTimeToUtcTime(v.timeFrom, timezone) : null,
      timeTo: v.timeTo ? localTimeToUtcTime(v.timeTo, timezone) : null,
      referrer: v.referrer?.trim() || null,
      campaign: v.campaign?.trim() || null,
      destination,
    });
  });
  return out;
}
