import type { LinkAppealStatus } from "./models";

/**
 * How an appeal against a platform block reads, for the owner and for the queue.
 *
 * The owner's link detail and the admin queue show the same three states, so they
 * read them from here: one owner for the wording, so a badge the operator reads
 * cannot name a state differently than the owner does.
 */
export const LINK_APPEAL_STATUS_LABEL: Record<LinkAppealStatus, string> = {
  open: "Revisión solicitada",
  upheld: "Bloqueo confirmado",
  restored: "Bloqueo retirado",
};

/** Every state, in the order a case moves through them, so no filter drops one. */
export const LINK_APPEAL_STATUS_ORDER: readonly LinkAppealStatus[] = [
  "open",
  "upheld",
  "restored",
];

export function linkAppealStatusLabel(status: LinkAppealStatus): string {
  return LINK_APPEAL_STATUS_LABEL[status];
}

/** The same three states as a set, for the response decoders to validate against. */
export const LINK_APPEAL_STATUSES: ReadonlySet<LinkAppealStatus> = new Set(LINK_APPEAL_STATUS_ORDER);
