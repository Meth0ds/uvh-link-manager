import type { LinkState } from "./models";

export interface DomainDeletionPreview {
  domainId: number;
  domain: string;
  isDefault: boolean;
  liveLinks: number;
  trashedLinks: number;
  blockedLinks: number;
  totalLinks: number;
  canDelete: boolean;
}

export interface DomainReassignmentRow {
  linkId: number;
  version: number;
  alias: string;
  oldUrl: string;
  newUrl: string;
  state: LinkState;
  inTrash: boolean;
  deletedAt: string | null;
  purgeAt: string | null;
  conflict: "blocked" | "alias_conflict" | null;
}

export interface DomainReassignmentPreview {
  domainId: number;
  targetDomainId: number | null;
  canApply: boolean;
  links: DomainReassignmentRow[];
}

export interface DomainReassignmentResult {
  ok: true;
  applied: number;
  domainId: number;
  targetDomainId: number | null;
  linkIds: number[];
}
