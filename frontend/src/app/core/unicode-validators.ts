import type { ValidatorFn } from "@angular/forms";

/** Same unit as Laravel mb_strlen: Unicode code points, not UTF-16 units. */
export function unicodeMaxLength(maximum: number): ValidatorFn {
  return (control) => {
    if (typeof control.value !== "string") return null;
    const length = Array.from(control.value).length;
    return length > maximum ? { maxlength: { requiredLength: maximum, actualLength: length } } : null;
  };
}
