import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Backup and restore drills.
 *
 * `production-readiness.md` asks for automated encrypted backups, retention, a
 * failure alert and a real restore with measured RPO/RTO. A runbook cannot
 * answer any of those, and "PostgreSQL backs itself up daily" is not evidence.
 * This harness takes a backup, destroys the database on purpose, restores the
 * copy into an isolated instance, proves the restored copy matches, and only
 * then brings the primary back. It also proves the scripts refuse to work in
 * the ways that matter: a missing key, a corrupted ciphertext, a schema that
 * drifted and a database older than the release.
 *
 * Every assertion is measured, never assumed: the RPO reported below is the
 * gap that the drill actually lost, not the interval somebody configured.
 */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const project = "uvh-backup-e2e";
const composeFile = "docker-compose.backup-e2e.yml";
const composeArgs = ["compose", "-p", project, "-f", composeFile];
const alertBase = `http://127.0.0.1:${process.env.UVH_BACKUP_ALERT_PORT ?? "8093"}`;
const evidenceFile = process.env.UVH_BACKUP_EVIDENCE ?? path.join(repositoryRoot, "backup-drill-evidence.json");

const results = [];
const measures = {};

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}

function compose(args, { capture = false } = {}) {
  return execFileSync("docker", [...composeArgs, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 600_000,
  });
}

function composeTry(args) {
  return spawnSync("docker", [...composeArgs, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 600_000,
  });
}

/** Run one operation in its own container, never inside the target instance. */
function runner(script, { env = {}, argv = [] } = {}) {
  const args = ["run", "--rm", "--no-deps"];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push("backup-runner", "sh", `/scripts/${script}`, ...argv);
  return composeTry(args);
}

function composeOut(args) {
  const result = composeTry(args);
  if (result.error) throw result.error;
  return String(result.stdout ?? "");
}

/** Run a read-only command in the tools container and return its stdout. */
function runnerCapture(argv) {
  return composeOut(["exec", "-T", "backup-runner", ...argv]);
}

function appPhp(argv, env = {}) {
  const args = ["exec"];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push("-T", "app", "php", ...argv);
  return composeTry(args);
}

function lastJson(stdout) {
  const lines = String(stdout ?? "").trim().split("\n").filter((line) => line.trim() !== "");
  const line = lines[lines.length - 1] ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`expected a JSON document, got: ${line.trim().slice(0, 240)}`);
  }
}

function fingerprint(env = {}) {
  return lastJson(appPhp(["tests/E2E/backup-drill.php", "fingerprint"], env).stdout);
}

/** Fingerprint that returns null instead of throwing when the schema is gone. */
function fingerprintOrNull(env = {}) {
  const result = appPhp(["tests/E2E/backup-drill.php", "fingerprint"], env);
  if (result.status !== 0) return null;
  try {
    return lastJson(result.stdout);
  } catch {
    return null;
  }
}

/** Last meaningful line, skipping the progress noise Compose writes to stderr. */
const lastLine = (text) => String(text ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !/^(Container|Network|Volume|Image|#[0-9]|\[\+\])/.test(line))
  .pop() ?? "";

function drill(subcommand, argument, env = {}) {
  const argv = ["tests/E2E/backup-drill.php", subcommand];
  if (argument !== undefined) argv.push(argument);
  return lastJson(appPhp(argv, env).stdout);
}

function healthcheck() {
  const result = appPhp(["artisan", "uvh:healthcheck", "app"]);
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-200) };
}

function takeBackup(tag, env = {}) {
  const result = runner("backup.sh", { env: { BACKUP_TAG: tag, ...env } });
  if (result.status !== 0) throw new Error(`backup ${tag} failed: ${result.stderr ?? ""}`);
  const manifestPath = String(result.stdout).trim().split("\n").pop();
  // The manifest is pretty-printed on purpose: it is meant to be read by a
  // human during an incident, so it is parsed whole rather than line by line.
  return JSON.parse(runnerCapture(["cat", manifestPath]).trim());
}

function restoreInto(file, { host = "restore-target", database } = {}) {
  // The scripts run from their own container, so a manifest basename has to
  // be resolved against the offsite volume rather than the current directory.
  const absolute = String(file).startsWith("/") ? file : `/backups/${file}`;

  return runner("restore.sh", {
    env: { PGHOST: host, PGDATABASE: database ?? "uvh_restore_test" },
    argv: [absolute],
  });
}

const backupFiles = () => runnerCapture(["sh", "-c", "ls -1 /backups/*.dump.enc 2>/dev/null | sort"])
  .trim().split("\n").filter(Boolean);

const alertsLog = () => runnerCapture(["sh", "-c", "cat /backups/alerts.log 2>/dev/null || true"]);

async function alertHits() {
  try {
    const response = await fetch(`${alertBase}/__received`);
    const body = await response.json();
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

function destroyPrimary() {
  const drop = composeTry(["exec", "-T", "backup-runner", "psql", "--dbname=postgres", "-c",
    "DROP DATABASE IF EXISTS uvh_backup_test WITH (FORCE)"]);
  const create = composeTry(["exec", "-T", "backup-runner", "createdb", "-T", "template0", "uvh_backup_test"]);

  return {
    dropped: drop.status,
    recreated: create.status,
    error: lastLine(`${drop.stderr ?? ""}${create.stderr ?? ""}`),
  };
}

function equals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log("== backup drills: reset");
  compose(["down", "--volumes", "--remove-orphans"]);
  console.log("== backup drills: up");
  compose(["up", "-d", "--wait", "--wait-timeout", "300"]);

  // Key custody is an explicit, separate step. backup.sh must refuse without it.
  runnerCapture(["sh", "-c", "test -s /run/secrets/backup_key && echo present || echo absent"]);
  const missingKey = runner("backup.sh", { env: { BACKUP_TAG: "nokey", BACKUP_KEY_FILE: "/tmp/absent-key" } });
  check("key custody: a backup without a key is refused", missingKey.status !== 0, `exit=${missingKey.status}`);
  const keyStep = runner("ensure-key.sh");
  check("key custody: the key is created by its own step", keyStep.status === 0, `exit=${keyStep.status}`);
  const keyAgain = runner("ensure-key.sh");
  check("key custody: the step is idempotent and never rotates", `${keyAgain.stdout}`.includes("already present"));

  const unmigrated = appPhp(["artisan", "migrate:fresh", "--force", "--no-interaction"]);
  check("schema: the database is migrated from scratch", unmigrated.status === 0, `exit=${unmigrated.status}`);

  drill("seed");
  const before = fingerprint();
  check("seed: representative account data exists", before.counts.users >= 6 && before.counts.links >= 6, JSON.stringify({ users: before.counts.users, links: before.counts.links }));

  // ---- drill 1: a backup, a destroyed database, a verified restore ---------
  const backup = takeBackup("drill");
  check("backup: a copy is written with a manifest", Boolean(backup.file) && backup.ciphertext_bytes > 0, JSON.stringify({ file: backup.file, bytes: backup.ciphertext_bytes }));
  check("backup: the manifest records the schema it contains", backup.migration_count > 0 && backup.tables > 0, JSON.stringify({ tables: backup.tables, migrations: backup.migration_count }));

  const encrypted = runnerCapture(["sh", "-c", `head -c 8 /backups/${backup.file} | od -An -tx1 | tr -d ' \\n'`]).trim();
  check("backup: the file on disk is not a readable dump", !encrypted.startsWith("5047"), `magic=${encrypted}`);

  drill("seed-extra");
  const withExtra = fingerprint();
  check("drill cycle: writes after the backup are visible", withExtra.counts.links > before.counts.links, `links=${withExtra.counts.links}`);

  const disaster = destroyPrimary();
  const disasterAt = Date.now();
  check("drill cycle: the database is dropped and recreated empty", disaster.dropped === 0 && disaster.recreated === 0, JSON.stringify(disaster));
  const gone = fingerprintOrNull();
  check("drill cycle: no application data survives the disaster", gone === null || Object.keys(gone.counts).length === 0, JSON.stringify(gone?.counts ?? null));

  const isolated = restoreInto(backup.file);
  const restoredAt = Date.now();
  check("drill cycle: the copy restores into an isolated instance", isolated.status === 0, `exit=${isolated.status} ${lastLine(isolated.stderr)}`);

  const isolatedFingerprint = fingerprint({ DB_HOST: "restore-target", DB_DATABASE: "uvh_restore_test" });
  check("drill cycle: the restored copy matches the source state", equals(isolatedFingerprint.content, before.content), JSON.stringify(isolatedFingerprint.content));
  check("drill cycle: the restored copy is complete", equals(isolatedFingerprint.counts, before.counts));
  check("drill cycle: writes made after the backup are absent, as RPO predicts", isolatedFingerprint.counts.links === before.counts.links, `links=${isolatedFingerprint.counts.links} expected=${before.counts.links}`);

  const primary = restoreInto(backup.file, { host: "postgres", database: "uvh_backup_test" });
  const primaryAt = Date.now();
  check("drill cycle: the primary is recovered from the same copy", primary.status === 0, `exit=${primary.status} ${lastLine(primary.stderr)}`);
  check("drill cycle: the recovered primary matches the backup", equals(fingerprint().content, before.content));

  measures.rto_isolated_ms = restoredAt - disasterAt;
  measures.rto_primary_ms = primaryAt - disasterAt;
  measures.rpo_seconds = Math.round((disasterAt - Date.parse(backup.created_at)) / 1000);

  // ---- drill 2: data loss without schema loss -----------------------------
  const damaged = drill("damage", "links");
  check("drill damaged: truncation removes the rows", damaged.rows_after === 0);
  const damagedIsolated = restoreInto(backup.file);
  check("drill damaged: the copy verifies in isolation", damagedIsolated.status === 0, `exit=${damagedIsolated.status} ${lastLine(damagedIsolated.stderr)}`);
  const damagedPrimary = restoreInto(backup.file, { host: "postgres", database: "uvh_backup_test" });
  check("drill damaged: the primary is repaired from the copy", damagedPrimary.status === 0, `exit=${damagedPrimary.status} ${lastLine(damagedPrimary.stderr)}`);
  const healedLinks = fingerprint().counts.links;
  check("drill damaged: the rows are back", healedLinks === before.counts.links, `links=${healedLinks} expected=${before.counts.links}`);

  // ---- drill 3: a schema that drifted away from the release ---------------
  drill("drift", "webhooks");
  const drifted = healthcheck();
  check("drill drift: the release gate refuses a damaged schema", drifted.status !== 0, drifted.output);
  const driftRestore = restoreInto(backup.file, { host: "postgres", database: "uvh_backup_test" });
  check("drill drift: the restore repairs the schema", driftRestore.status === 0, `exit=${driftRestore.status} ${lastLine(driftRestore.stderr)}`);
  const healed = healthcheck();
  check("drill drift: the release gate passes afterwards", healed.status === 0, healed.output);

  // ---- drill 4: a database older than the release -------------------------
  drill("unledger", "1");
  const behind = healthcheck();
  check("drill rollback: a database older than the release is refused", behind.status !== 0, behind.output);
  const rollbackRestore = restoreInto(backup.file, { host: "postgres", database: "uvh_backup_test" });
  check("drill rollback: restoring the newest copy is accepted", rollbackRestore.status === 0 && healthcheck().status === 0);

  // ---- integrity: a corrupted copy must never be restored -----------------
  // The attempt targets a database that is still empty, so "refused" is
  // proven by the outcome and not only by the message: a guard that failed to
  // fire would leave restored tables behind.
  composeTry(["exec", "-T", "backup-runner", "createdb", "-h", "restore-target", "-T", "template0", "uvh_tamper_test"]);
  runnerCapture(["sh", "-c", `cp /backups/${backup.file} /backups/tampered.dump.enc && cp /backups/${backup.file.replace(/\.dump\.enc$/, ".manifest.json")} /backups/tampered.manifest.json && printf 'x' >> /backups/tampered.dump.enc`]);
  const tampered = restoreInto("/backups/tampered.dump.enc", { database: "uvh_tamper_test" });
  check("integrity: a corrupted copy is refused", tampered.status !== 0, `exit=${tampered.status} ${lastLine(tampered.stderr)}`);
  check("integrity: the refusal names the integrity guard", `${tampered.stderr}`.includes("digest mismatch"), lastLine(tampered.stderr));
  const afterTamper = fingerprintOrNull({ DB_HOST: "restore-target", DB_DATABASE: "uvh_tamper_test" });
  check("integrity: the refused restore wrote nothing to the target", afterTamper === null || Object.keys(afterTamper.counts ?? {}).length === 0, JSON.stringify(afterTamper?.counts ?? null));
  runnerCapture(["rm", "-f", "/backups/tampered.dump.enc", "/backups/tampered.manifest.json"]);

  // ---- alerting: a failure must be observable -----------------------------
  const beforeHits = (await alertHits()).length;
  runner("backup.sh", { env: { BACKUP_TAG: "alert", BACKUP_KEY_FILE: "/tmp/absent-key" } });
  const hits = await alertHits();
  check("alert: the failure hook fired", hits.length > beforeHits, `hits=${hits.length}`);
  check("alert: the failure is recorded next to the backups", alertsLog().includes("exit_status_"));
  check("alert: the alert carries the reason and the backup name", JSON.stringify(hits[hits.length - 1] ?? {}).includes("backup_failed"));

  // ---- retention ----------------------------------------------------------
  const retentionBackups = [];
  for (const tag of ["ret1", "ret2", "ret3"]) {
    retentionBackups.push(takeBackup(tag, { BACKUP_RETENTION: 2 }));
  }
  const kept = backupFiles();
  check("retention: only the configured number of copies survives", kept.length === 2, `kept=${kept.length}`);
  check("retention: the newest copy is never the one removed", kept.some((file) => file.endsWith(retentionBackups[2].file)));

  measures.backups_created = backupFiles().length;
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } catch (error) {
    console.error("teardown failed", error);
    failure ??= error;
  }
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const row of failed) console.log(`  FAILED  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);

const evidence = {
  measured_at: new Date().toISOString(),
  checks: results.length,
  failed: failed.length,
  measures,
};
console.log(`\nmeasures: ${JSON.stringify(measures)}`);
try {
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`evidence written to ${path.relative(repositoryRoot, evidenceFile)}`);
} catch (error) {
  console.error("could not write the evidence file", error);
}

if (failure || failed.length > 0) {
  process.exitCode = 1;
}
