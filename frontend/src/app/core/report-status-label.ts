import type { AdminReport } from "./models";

/**
 * Where an abuse report stands in the moderation queue.
 *
 * The per-report badge and the queue's own status filter read the same words, so
 * "Resuelta" in the filter cannot mean a different case than "Resuelta" on the
 * card it selects.
 *
 * The wording is singular because it describes one report; a filter over that
 * state reads the same way in Spanish ("Estado: Resuelta" agrees with denuncia).
 */
export const REPORT_STATUS_LABEL: Record<AdminReport["status"], string> = {
  open: "Abierta",
  reviewed: "Revisada",
  actioned: "Resuelta",
  dismissed: "Desestimada",
};

/** Every state, in triage order, so the filter cannot silently drop one. */
export const REPORT_STATUS_ORDER: readonly AdminReport["status"][] = [
  "open",
  "reviewed",
  "actioned",
  "dismissed",
];

export function reportStatusLabel(status: AdminReport["status"]): string {
  return REPORT_STATUS_LABEL[status];
}
