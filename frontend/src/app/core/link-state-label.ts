import type { LinkState } from "./models";

/**
 * How a link state is written in the panel.
 *
 * The list, the dashboard and the link detail all read this map. Keeping it in
 * one place means a state cannot be translated in one surface and printed as a
 * raw enum value in another.
 */
export const LINK_STATE_LABEL: Record<LinkState, string> = {
  scheduled: "Programado",
  active: "Activo",
  paused: "En pausa",
  expired: "Caducado",
  blocked: "Bloqueado",
  archived: "Archivado",
  deleted: "Eliminado",
};

const LINK_STATE_KEYS: readonly LinkState[] = [
  "scheduled",
  "active",
  "paused",
  "expired",
  "blocked",
  "archived",
  "deleted",
];

/**
 * The states this vocabulary can name, as a set.
 *
 * It is what the response decoders validate against: a payload that carried an
 * unknown state has to be refused, and the list of valid ones belongs with the
 * labels that name them, not copied into each decoder.
 */
export const LINK_STATES: ReadonlySet<LinkState> = new Set(LINK_STATE_KEYS);

export function linkStateLabel(state: LinkState): string {
  return LINK_STATE_LABEL[state];
}

/**
 * Whether a state the API returned as text is one this vocabulary can name.
 *
 * Some payloads carry the state of a related link as a plain string (the admin
 * report queue does), and printing the raw value would put an enum in front of
 * an operator.
 */
export function isLinkState(value: string): value is LinkState {
  return LINK_STATES.has(value as LinkState);
}
