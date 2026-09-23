/**
 * A timestamp as the panel prints it.
 *
 * Two shapes have to survive: the ISO 8601 the API writes for the records it
 * shapes itself, and PostgreSQL's own `Y-m-d H:i:s±HH` text for the rows it hands
 * over raw. The second one is not ISO: the space has to become a `T` and a
 * two-digit offset has to carry its minutes (`+00` → `+00:00`), or every engine
 * refuses it and the date prints as unreadable. Both are normalised here, once,
 * for every screen that prints a date.
 *
 * The panel reads a date in two measures, and this module is the only place
 * either of them is decided:
 *
 *   - `dateTimeLabel` — «22/9/2026, 1:38:16», la lectura de la consola;
 *   - `dateTimeMediumLabel` — «22 sept 2026, 1:38», la de cuenta y seguridad.
 */

const MEDIUM = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });

function read(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** La lectura de la consola: numérica y con segundos. */
export function dateTimeLabel(value: string): string {
  const date = read(value);
  return date === null ? "—" : date.toLocaleString("es-ES");
}

/**
 * La lectura de las pantallas de cuenta, seguridad, papelera, webhooks y detalle
 * de dominio. `fallback` es el texto propio de cada una para un hueco («Sin
 * registro disponible», «Todavía no disponible»…): la fecha no lo decide.
 */
export function dateTimeMediumLabel(value: string | null, fallback = "—"): string {
  const date = read(value);
  return date === null ? fallback : MEDIUM.format(date);
}
