import type { LinkHistoryComparison, LinkHistoryDetail, LinkHistoryEntry, LinkHistoryResponse, RuleSimulationResult } from "../models";
import { boundedArray, integer, invalid, literal, nullableText, record, text } from "./response-decoder-helpers";

const SOURCES = new Set<LinkHistoryEntry["source"]>(["create", "update", "duplicate", "restore", "import", "bulk"]);
const SIMULATION_SOURCES = new Set<RuleSimulationResult["source"]>(["rule", "fallback", "primary"]);

function timestamp(value: unknown, contract: string): string {
  const decoded = text(value, contract, 64);
  if (!Number.isFinite(Date.parse(decoded))) invalid(contract);
  return decoded;
}

function entry(value: unknown): LinkHistoryEntry {
  const source = record(value, "link history entry");
  return {
    revision: integer(source["revision"], "link history revision", 1),
    linkVersion: integer(source["linkVersion"], "link history link version", 1),
    source: literal(source["source"], SOURCES, "link history source"),
    actor: nullableText(source["actor"], "link history actor", 160, true),
    changedFields: boundedArray(source["changedFields"], "link history changed fields", 64).map((field) => text(field, "link history field", 80)),
    createdAt: timestamp(source["createdAt"], "link history timestamp"),
  };
}

export function decodeLinkHistoryResponse(value: unknown): LinkHistoryResponse {
  const source = record(value, "link history response");
  return {
    versions: boundedArray(source["versions"], "link history versions", 50).map(entry),
    page: integer(source["page"], "link history page", 1),
    perPage: integer(source["perPage"], "link history per page", 1, 50),
    lastPage: integer(source["lastPage"], "link history last page", 1),
  };
}

export function decodeLinkHistoryDetail(value: unknown): LinkHistoryDetail {
  const source = record(value, "link history detail");
  return { ...entry(source), configuration: record(source["configuration"], "link history configuration") };
}

export function decodeLinkHistoryComparison(value: unknown): LinkHistoryComparison {
  const source = record(value, "link history comparison");
  return {
    from: entry(source["from"]),
    to: entry(source["to"]),
    changes: boundedArray(source["changes"], "link history changes", 64).map((value) => {
      const row = record(value, "link history change");
      return { field: text(row["field"], "link history change field", 80), before: row["before"], after: row["after"] };
    }),
  };
}

export function decodeRuleSimulationResult(value: unknown): RuleSimulationResult {
  const source = record(value, "rule simulation result");
  const matched = source["ruleIndex"] === null ? null : integer(source["ruleIndex"], "rule simulation index", 0, 19);
  const id = source["ruleId"] === null ? null : integer(source["ruleId"], "rule simulation rule id", 1);
  const priority = source["priority"] === null ? null : integer(source["priority"], "rule simulation priority", 0, 1000);
  const warningSource = record(source["warnings"], "rule simulation warnings");
  return {
    source: literal(source["source"], SIMULATION_SOURCES, "rule simulation source"),
    ruleIndex: matched,
    ruleId: id,
    priority,
    destination: text(source["destination"], "rule simulation destination", 2048),
    destinationWithUtm: text(source["destinationWithUtm"], "rule simulation destination with UTM", 2048),
    evaluatedAtUtc: timestamp(source["evaluatedAtUtc"], "rule simulation timestamp"),
    input: record(source["input"], "rule simulation input"),
    warnings: {
      shadowedRules: boundedArray(warningSource["shadowedRules"], "rule simulation shadowed rules", 20).map((item) => integer(item, "rule simulation shadowed rule", 0, 19)),
      overlappingRules: boundedArray(warningSource["overlappingRules"], "rule simulation overlapping rules", 20).map((item) => integer(item, "rule simulation overlapping rule", 0, 19)),
      duplicateDestinations: boundedArray(warningSource["duplicateDestinations"], "rule simulation duplicate destinations", 20).map((group) => boundedArray(group, "rule simulation duplicate destination group", 20).map((item) => integer(item, "rule simulation duplicate destination", 0, 19))),
      impossibleRules: boundedArray(warningSource["impossibleRules"] ?? [], "rule simulation impossible rules", 20).map((item) => integer(item, "rule simulation impossible rule", 0, 19)),
      timezoneWarnings: boundedArray(warningSource["timezoneWarnings"] ?? [], "rule simulation timezone warnings", 4).map((item) => text(item, "rule simulation timezone warning", 40)),
    },
  };
}
