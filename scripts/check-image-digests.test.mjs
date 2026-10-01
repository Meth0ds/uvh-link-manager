import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/check-image-digests.mjs");

test("a drifted tag with an unavailable pin fails the strict availability gate", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uvh-digest-contract-"));
  try {
    const references = execFileSync(process.execPath, [script, "--offline", "--references"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    const digests = Object.fromEntries(references.map((reference) => reference.split("@")));
    const selected = Object.keys(digests)[0];
    const name = selected.slice(0, selected.lastIndexOf(":"));
    const binary = path.join(directory, "bin");
    mkdirSync(binary);
    writeFileSync(path.join(binary, "docker"), `#!${process.execPath}\nconst digests = ${JSON.stringify(digests)};\nconst selected = ${JSON.stringify(selected)};\nconst name = ${JSON.stringify(name)};\nif (process.argv[3] === "version") { process.stdout.write("fixture buildx\\n"); process.exit(0); }\nconst reference = process.argv[5];\nif (reference === name + "@" + digests[selected] && !process.env.UVH_FIXTURE_PIN_AVAILABLE) {\n process.stderr.write("429 Too Many Requests\\n"); process.exit(1);\n}\nconst digest = reference === selected ? "sha256:" + "f".repeat(64)\n : (digests[reference] ?? reference.split("@")[1]);\nprocess.stdout.write(digest + "\\n");\n`, { mode: 0o755 });
    const loader = path.join(directory, "offline.mjs");
    writeFileSync(loader, 'globalThis.fetch = async () => { throw new Error("fixture offline"); };\nglobalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };\n');
    const report = path.join(directory, "report.json");
    const env = { ...process.env, PATH: `${binary}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: `--import=${loader}` };
    const args = [script, "--quiet", "--fail-on-unavailable", `--json=${report}`];
    const unavailable = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
    assert.equal(unavailable.status, 1, unavailable.stderr);
    assert.ok(existsSync(report), `${unavailable.stdout}\n${unavailable.stderr}`);
    const failed = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(failed.unavailable.length, 1);
    assert.equal(failed.drift[0].pinVerified, false);
    const verified = spawnSync(process.execPath, args, { cwd: root, env: { ...env, UVH_FIXTURE_PIN_AVAILABLE: "1" }, encoding: "utf8", timeout: 10000 });
    assert.equal(verified.status, 0, verified.stderr);
    const passed = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(passed.unavailable.length, 0);
    assert.equal(passed.drift[0].pinVerified, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
