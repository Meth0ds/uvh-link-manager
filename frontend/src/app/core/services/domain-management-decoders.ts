import type { DomainDeletionPreview, DomainReassignmentPreview, DomainReassignmentResult, DomainReassignmentRow } from "../domain-management";
import { LINK_STATES } from "../link-state-label";
import { boolean, boundedArray, httpUrl, integer, invalid, literal, nullableInteger, nullableText, record, text } from "./response-decoder-helpers";

export function decodeDomainDeletionPreview(value: unknown, domainId: number): DomainDeletionPreview {
  const source = record(value, "domain deletion preview");
  const decoded: DomainDeletionPreview = {
    domainId: integer(source["domainId"], "domain deletion id", 1),
    domain: text(source["domain"], "domain deletion hostname", 253),
    isDefault: boolean(source["isDefault"], "domain deletion preference"),
    liveLinks: integer(source["liveLinks"], "domain live links"),
    trashedLinks: integer(source["trashedLinks"], "domain trashed links"),
    blockedLinks: integer(source["blockedLinks"], "domain blocked links"),
    totalLinks: integer(source["totalLinks"], "domain total links"),
    canDelete: boolean(source["canDelete"], "domain deletion readiness"),
  };
  if (decoded.domainId !== domainId || decoded.totalLinks !== decoded.liveLinks + decoded.trashedLinks
    || decoded.blockedLinks > decoded.totalLinks || decoded.canDelete !== (decoded.totalLinks === 0)) invalid("domain deletion consistency");
  return decoded;
}

function timestamp(value: unknown): string | null {
  const result = nullableText(value, "domain reassignment timestamp", 64);
  if (result !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result)))) invalid("domain reassignment timestamp");
  return result;
}

export function decodeDomainReassignmentPreview(value: unknown, domainId: number, targetDomainId: number | null, ids: readonly number[]): DomainReassignmentPreview {
  const source = record(value, "domain reassignment preview");
  const links = boundedArray(source["links"], "domain reassignment links", 100).map((item): DomainReassignmentRow => {
    const row = record(item, "domain reassignment link");
    const decoded: DomainReassignmentRow = {
      linkId: integer(row["linkId"], "domain reassignment link id", 1),
      version: integer(row["version"], "domain reassignment version", 1),
      alias: text(row["alias"], "domain reassignment alias", 64),
      oldUrl: httpUrl(row["oldUrl"], "domain reassignment old URL"),
      newUrl: httpUrl(row["newUrl"], "domain reassignment new URL"),
      state: literal(row["state"], LINK_STATES, "domain reassignment state"),
      inTrash: boolean(row["inTrash"], "domain reassignment trash"),
      deletedAt: timestamp(row["deletedAt"]), purgeAt: timestamp(row["purgeAt"]),
      conflict: row["conflict"] === null ? null : literal(row["conflict"], new Set(["blocked", "alias_conflict"] as const), "domain reassignment conflict"),
    };
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(decoded.alias)
      || decoded.inTrash !== (decoded.state === "deleted") || decoded.inTrash !== (decoded.deletedAt !== null)
      || decoded.inTrash !== (decoded.purgeAt !== null)
      || (decoded.inTrash && Date.parse(decoded.purgeAt!) <= Date.parse(decoded.deletedAt!))) invalid("domain reassignment row consistency");
    return decoded;
  });
  const decoded = {
    domainId: integer(source["domainId"], "domain reassignment source", 1),
    targetDomainId: nullableInteger(source["targetDomainId"], "domain reassignment target", 1),
    canApply: boolean(source["canApply"], "domain reassignment readiness"), links,
  };
  if (decoded.domainId !== domainId || decoded.targetDomainId !== targetDomainId || links.length !== ids.length || links.length === 0
    || new Set(links.map((row) => row.linkId)).size !== ids.length || links.some((row) => !ids.includes(row.linkId))
    || decoded.canApply !== links.every((row) => row.conflict === null)) invalid("domain reassignment preview context");
  return decoded;
}

export function decodeDomainReassignmentResult(value: unknown, preview: DomainReassignmentPreview): DomainReassignmentResult {
  const source = record(value, "domain reassignment result");
  const ids = boundedArray(source["linkIds"], "domain reassignment result ids", 100).map((id) => integer(id, "domain reassignment result id", 1));
  const decoded: DomainReassignmentResult = {
    ok: true, applied: integer(source["applied"], "domain reassignment applied", 1, 100),
    domainId: integer(source["domainId"], "domain reassignment source", 1),
    targetDomainId: nullableInteger(source["targetDomainId"], "domain reassignment target", 1), linkIds: ids,
  };
  if (source["ok"] !== true || decoded.domainId !== preview.domainId || decoded.targetDomainId !== preview.targetDomainId
    || decoded.applied !== preview.links.length || ids.length !== decoded.applied || new Set(ids).size !== ids.length
    || ids.some((id) => !preview.links.some((row) => row.linkId === id))) invalid("domain reassignment result context");
  return decoded;
}
