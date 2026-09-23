/**
 * A count with its noun in the right number.
 *
 * The interface prints counts in several places ("1 denuncia abierta", "3
 * trabajos fallidos", "1 enlace recupera su estado"), and the rule is the same
 * everywhere: the noun changes with the count. Spelling it out once keeps a new
 * count from shipping "1 enlaces".
 */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
