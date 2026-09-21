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

const LINK_STATES: readonly LinkState[] = [
  "scheduled",
  "active",
  "paused",
  "expired",
  "blocked",
  "archived",
  "deleted",
];

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
  return (LINK_STATES as readonly string[]).includes(value);
}
