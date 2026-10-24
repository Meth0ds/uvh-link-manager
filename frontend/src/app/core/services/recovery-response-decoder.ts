import { boolean, boundedArray, integer, nullableText as boundedNullableText, record, text as boundedText } from "./response-decoder-helpers";
const text = (value: unknown, contract: string): string => boundedText(value, contract, 8192);
const nullableText = (value: unknown, contract: string): string | null => boundedNullableText(value, contract, 8192);
export interface RecoverySnapshot {
  enabled: boolean;
  recoveryConfigured: boolean;
  maintenance: { maintenance: boolean; reason: string | null };
  github: { from: string; sha: string; eligible: boolean; stale: boolean; checkedAt: string; checks: { workflow: string; state: string }[]; commits: { sha: string; message: string }[] } | null;
  operation: { id: string; action: string; state: string; phase: string; error: string | null } | null;
  backups: { id: string; sha: string; createdAt: string; restoredAt: string | null; bytes: number }[];
  destinations: { id: string; name: string; type: string; configured: boolean; status: string | null }[];
  policy: { dailyRetention: number; weeklyRetention: number; updateRetention: number };
  updatedAt: string;
}
export function decodeRecoverySnapshot(value: unknown): RecoverySnapshot {
  const source = record(value, "recovery snapshot"), maintenance = record(source["maintenance"], "maintenance");
  const github = source["github"] === null ? null : record(source["github"], "GitHub");
  const operation = source["operation"] === null ? null : record(source["operation"], "recovery operation");
  return {
    enabled: boolean(source["enabled"], "recovery enabled"), recoveryConfigured: boolean(source["recoveryConfigured"], "recovery configured"),
    maintenance: { maintenance: boolean(maintenance["maintenance"], "maintenance state"), reason: nullableText(maintenance["reason"], "maintenance reason") },
    updatedAt: text(source["updatedAt"], "recovery time"),
    github: github ? { from: text(github["from"], "source SHA"), sha: text(github["sha"], "target SHA"), eligible: boolean(github["eligible"], "candidate eligibility"), stale: boolean(github["stale"], "candidate stale"), checkedAt: text(github["checkedAt"], "check time"),
      checks: boundedArray(github["checks"], "checks", 3).map(item => { const check = record(item, "check"); return { workflow: text(check["workflow"], "workflow"), state: text(check["state"], "check state") }; }),
      commits: boundedArray(github["commits"], "commits", 100).map(item => { const commit = record(item, "commit"); return { sha: text(commit["sha"], "commit SHA"), message: text(commit["message"], "commit message") }; }) } : null,
    operation: operation ? { id: text(operation["id"], "operation ID"), action: text(operation["action"], "operation action"), state: text(operation["state"], "operation state"), phase: text(operation["phase"], "operation phase"),
      error: operation["error"] === null ? null : text(record(operation["error"], "operation error")["message"], "error message") } : null,
    destinations: boundedArray(source["destinations"], "destinations", 20).map(item => { const destination = record(item, "destination"); return { id: text(destination["id"], "destination ID"), name: text(destination["name"], "destination name"), type: text(destination["type"], "destination type"), configured: boolean(destination["configured"], "destination configured"), status: destination["status"] === undefined || destination["status"] === null ? null : text(destination["status"], "destination status") }; }),
    policy: (() => { const policy = record(source["policy"], "backup policy"); return { dailyRetention: integer(policy["dailyRetention"], "daily retention", 1, 90), weeklyRetention: integer(policy["weeklyRetention"], "weekly retention", 1, 52), updateRetention: integer(policy["updateRetention"], "update retention", 1, 30) }; })(),
    backups: boundedArray(source["backups"], "backups", 1000).map(item => { const backup = record(item, "backup"); return { id: text(backup["id"], "backup ID"), sha: text(backup["sha"], "backup SHA"), createdAt: text(backup["createdAt"], "backup time"), restoredAt: nullableText(backup["restoredAt"], "backup restore time"), bytes: integer(backup["bytes"], "backup size", 0, Number.MAX_SAFE_INTEGER) }; }),
  };
}
export function decodeRecoveryTicket(value: unknown): string {
  return text(record(value, "recovery access")["ticket"], "recovery ticket");
}
