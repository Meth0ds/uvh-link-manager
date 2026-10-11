import { invalid, nullableText } from "./response-decoder-helpers";

/** Old servers omit names; an explicit invalid value is never silently hidden. */
export function decodeLinkName(value: unknown): string | null {
  if (value === undefined) return null;
  const name = nullableText(value, "link name", 120);
  if (name !== null && (name.trim() !== name || /[\p{Cc}\p{Cf}]/u.test(name))) invalid("link name");
  return name;
}
