import { FormControl } from "@angular/forms";
import { unicodeMaxLength } from "./unicode-validators";

describe("Unicode form lengths", () => {
  it("allows supplementary characters and rejects actual overflow", () => {
    const control = new FormControl("😀".repeat(40), unicodeMaxLength(40));
    expect(control.valid).toBeTrue();
    control.setValue("😀".repeat(41));
    expect(control.getError("maxlength")).toEqual({ requiredLength: 40, actualLength: 41 });
  });
});
