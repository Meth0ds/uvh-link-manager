import type { AdminDestinationEntry } from "./models";

/**
 * How far one denylist entry reaches, and how far a block would reach.
 *
 * The queue's block action and the entry it produces name the same two scopes,
 * so the button an operator presses and the row they later read use one wording:
 * a mismatch there would read as two different rules.
 */
export const DESTINATION_KIND_LABEL: Record<AdminDestinationEntry["match_kind"], string> = {
  host: "Todo el host",
  url: "URL exacta",
};

/** Where an entry came from: which is who can argue with it. */
export const DESTINATION_SOURCE_LABEL: Record<AdminDestinationEntry["source"], string> = {
  manual: "Manual",
  provider: "Proveedor",
  report: "Denuncia",
};

export function destinationKindLabel(kind: AdminDestinationEntry["match_kind"]): string {
  return DESTINATION_KIND_LABEL[kind];
}

export function destinationSourceLabel(source: AdminDestinationEntry["source"]): string {
  return DESTINATION_SOURCE_LABEL[source];
}
