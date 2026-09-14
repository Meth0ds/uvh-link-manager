#!/usr/bin/env node
// Production boot contract.
//
// The browser release smoke (npm run release:e2e) builds the production images
// but runs them with APP_ENV=testing, so the entrypoint never executes its
// production branch: `php artisan config:cache` and `php artisan uvh:release-check`
// are skipped, and a configuration that cannot serve is never noticed.
//
// This runner boots the same image the way production does and then proves each
// invariant individually: one broken value must stop the container, with the
// specific error and no other. A gate that fails for the wrong reason, or that
// fails only sometimes, is worse than no gate at all, so every case asserts the
// exact message that the production gate reports.
//
// Every container started here is named and time-boxed. A regression that makes
// the image keep serving instead of refusing must be reported as a failure in
// seconds; waiting on a container that will never exit would turn one broken
// invariant into a stalled pipeline.
//
// It lives next to the other node-orchestrated docker fixtures, but it is a
// contract test for the PHP runtime image, not a browser test.
//
// Run it with: npm run release:boot

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = "docker-compose.release-boot.yml";
const projectName = "uvh-release-boot";
const fixturePath = "docker/release-boot/production.env";
const appService = "app";
const bootTimeoutMs = 180_000;
// A container that must refuse to start exits in seconds here, because the gate
// runs before the framework serves anything. The allowance is generous for a cold
// CI runner while still bounding the run: a regression that leaves the container
// serving must cost a minute, not the whole job timeout.
const refusalTimeoutMs = 60_000;
// Lifecycle calls include building images, which is slow on a cold CI runner.
const lifecycleTimeoutMs = 900_000;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function expect(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return true;
  }
  failures.push(name);
  console.log(`  FAIL  ${name}`);
  if (detail) {
    console.log(
      String(detail)
        .trimEnd()
        .split("\n")
        .slice(0, 14)
        .map((line) => `        | ${line}`)
        .join("\n"),
    );
  }
  return false;
}

function section(title) {
  console.log(`\n${title}`);
}

function sleep(milliseconds) {
  // Synchronous sleep: the whole runner is a sequential docker orchestrator.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// ---------------------------------------------------------------------------
// Docker plumbing
// ---------------------------------------------------------------------------

function docker(args, options = {}) {
  const timeout = options.timeoutMs ?? lifecycleTimeoutMs;
  const result = spawnSync("docker", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";

  return {
    status: timedOut || result.error ? 1 : (result.status ?? 1),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    timedOut,
    timeoutSeconds: Math.round(timeout / 1000),
  };
}

function compose(args, options = {}) {
  return docker(["compose", "-p", projectName, "-f", composeFile, ...args], options);
}

let runSequence = 0;

// `--name` is not cosmetic: when a case regresses into a container that never
// exits, the runner has to be able to remove that exact container instead of
// leaving it competing with later cases.
function composeRun(overrides, command, timeoutMs) {
  runSequence += 1;
  const containerName = `${projectName}-assert-${runSequence}`;
  const result = compose(
    [
      "run",
      "--rm",
      "--no-deps",
      "--name",
      containerName,
      ...overrides.flatMap((value) => ["-e", value]),
      appService,
      ...command,
    ],
    { timeoutMs },
  );

  return { ...result, containerName };
}

function expectRefusal({ name, overrides = [], command = [], message, output }) {
  const result = composeRun(overrides, command, refusalTimeoutMs);

  if (result.timedOut) {
    docker(["rm", "-f", result.containerName]);
    expect(
      name,
      false,
      `the container was still running after ${result.timeoutSeconds}s instead of refusing to start.\n` +
        `An image that keeps serving with a broken invariant is exactly what this gate exists to catch.\n` +
        result.output,
    );
    return;
  }

  if (!expect(name, result.status !== 0, result.output)) {
    return;
  }

  if (message !== undefined) {
    expect(
      `${name} — reports exactly the expected invariant`,
      gatePayload(result.output) === message,
      `expected: ${message}\nreported: ${gatePayload(result.output) ?? "<no configuration error at all>"}`,
    );
  }
  if (output !== undefined) {
    expect(
      `${name} — reports the expected release condition`,
      result.output.includes(output),
      `expected output to include: ${output}\n${result.output}`,
    );
  }
}

// A missing container is not a docker failure: it is simply not running yet.
function serviceContainerId(service) {
  const result = compose(["ps", "-q", service]);
  const id = result.output.trim().split("\n")[0];
  return id === "" ? null : id;
}

function containerLogs(container) {
  return docker(["logs", container]).output;
}

function waitForHealth(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let status = "not-created";
  while (Date.now() < deadline) {
    const container = serviceContainerId(service);
    if (container !== null) {
      status = docker(["inspect", "--format", "{{.State.Health.Status}}", container]).output.trim();
      if (status === "healthy") {
        return { healthy: true, container };
      }
      if (status === "unhealthy") {
        return { healthy: false, container, status };
      }
    }
    sleep(1_000);
  }
  return { healthy: false, container: serviceContainerId(service), status };
}

// The production gate reports every broken invariant on one line. Extracting the
// payload lets a case assert both the exact wording and that nothing else was
// reported, which is what makes "one broken value" a real claim.
//
// Only the log line is parsed. Symfony also renders the same failure into a
// padded, wrapped console box, so anchoring on the first occurrence would read a
// truncated fragment and make every case look like a mismatch.
const gateMarker = "Configuración de seguridad de producción inválida: ";
const gateLogMarker = `production.ERROR: ${gateMarker}`;

function gatePayload(output) {
  const logIndex = output.indexOf(gateLogMarker);
  const consoleIndex = output.indexOf(gateMarker);
  const index = logIndex === -1 ? consoleIndex : logIndex;
  if (index === -1) {
    return null;
  }

  const start = index + (logIndex === -1 ? gateMarker.length : gateLogMarker.length);
  const line = output.slice(start).split("\n")[0];
  // Laravel appends the exception payload to the same line when it is enabled.
  const jsonStart = line.indexOf(' {"');
  return (jsonStart === -1 ? line : line.slice(0, jsonStart)).trim();
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const fixture = readFileSync(path.join(repositoryRoot, fixturePath), "utf8");

function fixtureValue(key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(fixture);
  return match === null ? "" : match[1].trim();
}

/**
 * The shipped production template is part of the contract, not documentation.
 *
 * A deployer copies it, so a template that points cache, rate limits, locks or
 * queues somewhere else describes a deployment this gate never boots. It had
 * already drifted once — both stores still said `database` after Redis became
 * the production topology, and no `REDIS_QUEUE_RETRY_AFTER` at all — and nothing
 * failed, because nothing compared the two files.
 */
const productionTemplatePath = "backend-laravel/.env.production.example";
const productionTemplate = readFileSync(path.join(repositoryRoot, productionTemplatePath), "utf8");

function templateValue(key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(productionTemplate);
  return match === null ? null : match[1].trim();
}

// Keys whose value decides where shared state lives: they must be stated in the
// template and agree with the fixture, which is the topology proven to boot.
const topologyKeys = [
  "CACHE_STORE",
  "CACHE_LIMITER",
  "CACHE_FAILOVER_STORES",
  "QUEUE_CONNECTION",
  "REDIS_CLIENT",
  "REDIS_DB",
  "REDIS_CACHE_DB",
  "REDIS_PREFIX",
  "CACHE_PREFIX",
];

// The retry window is compared by range rather than by value: its exact number
// is a per-deployment budget (the worker timeouts of that deployment), and the
// fixture runs a different worker budget than production does.
const retryWindowKey = "REDIS_QUEUE_RETRY_AFTER";
const retryWindowFloor = 200;

const mainDatabase = fixtureValue("DB_DATABASE");
const emptyDatabase = "uvh_release_boot_empty_test";

for (const database of [mainDatabase, emptyDatabase]) {
  if (!database.endsWith("_test")) {
    // Refuse rather than risk mutating a database that outlives this run.
    console.error(
      `Refusing to run the boot contract: "${database}" does not end in _test.\n` +
        "The contract deletes migration ledger rows and resets schema, so it may only touch throwaway databases.",
    );
    process.exit(64);
  }
}

if (fixtureValue("APP_ENV") !== "production") {
  console.error(
    `Refusing to run the boot contract: ${fixturePath} sets APP_ENV=${fixtureValue("APP_ENV")}, and the ` +
      "whole point of this gate is to exercise the production startup branch.",
  );
  process.exit(64);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

// Each case changes exactly one value from the fixture. Keeping the expected
// message beside the mutation makes it obvious what stops being tested if one is
// ever removed, and the exact-match assertion proves the failure came from the
// mutated value and nothing else.
const configurationCases = [
  {
    name: "a missing APP_SECRET stops the container",
    overrides: ["APP_SECRET="],
    message: "APP_SECRET debe ser Base64URL aleatorio, independiente y representar al menos 32 bytes en producción",
  },
  {
    name: "an unsafe COOKIE_SECURE stops the container",
    overrides: ["COOKIE_SECURE=false"],
    message: "COOKIE_SECURE debe estar activado en producción",
  },
  {
    name: "a shared COOKIE_DOMAIN stops the container",
    overrides: ["COOKIE_DOMAIN=.uvh.es"],
    message: "COOKIE_DOMAIN debe permanecer vacío para aislar app.uvh.es",
  },
  {
    name: "a universal TRUSTED_PROXIES stops the container",
    overrides: ["TRUSTED_PROXIES=0.0.0.0/0"],
    message: "TRUSTED_PROXIES debe contener sólo IP/CIDR concretos; se prohíben comodines y redes universales",
  },
  {
    name: "APP_DEBUG=true stops the container",
    overrides: ["APP_DEBUG=true"],
    message: "APP_DEBUG debe ser false en producción",
  },
  {
    name: "a test-only captcha fallback stops the container",
    overrides: ["HCAPTCHA_DEV_FALLBACK=true"],
    message: "HCAPTCHA_DEV_FALLBACK debe ser false en producción",
  },
  {
    name: "plaintext database traffic stops the container",
    overrides: ["DB_SSLMODE=require"],
    message: "DB_SSLMODE debe ser verify-full en producción",
  },
  {
    name: "a bcrypt cost outside the safe range stops the container",
    overrides: ["BCRYPT_ROUNDS=8"],
    message: "BCRYPT_ROUNDS debe estar entre 12 y 16 en producción",
  },
  // Redis is the production store for cache, rate limits, locks and queues, so
  // its own invariants need the same treatment as the rest: each of these makes
  // the container refuse to start, for its own reason only.
  {
    name: "an unauthenticated Redis stops the container",
    overrides: ["REDIS_PASSWORD="],
    message: "REDIS_PASSWORD debe ser un secreto concreto y robusto en producción",
  },
  {
    name: "a loopback Redis stops the container",
    overrides: ["REDIS_HOST=127.0.0.1"],
    message: "REDIS_HOST debe apuntar a un host compartido entre procesos, no a loopback, en producción",
  },
  {
    name: "a per-process rate limit store stops the container",
    overrides: ["CACHE_LIMITER=array"],
    message: "CACHE_LIMITER debe usar uno o más stores compartidos entre procesos en producción",
  },
  {
    name: "a Redis queue retry window shorter than the worker budget stops the container",
    overrides: ["REDIS_QUEUE_RETRY_AFTER=90"],
    message: "El retry_after de la cola debe estar entre 200 y 3600 segundos para superar el timeout máximo de los workers",
  },
];

const missingSchema = "Falta el registro de migraciones";

console.log("Production boot contract: the production image must refuse to start on a broken invariant.");
console.log(`Compose file: ${composeFile}`);
console.log(`Environment fixture: ${fixturePath} (database ${mainDatabase})`);

let teardownNeeded = false;

try {
  // -------------------------------------------------------------------------
  section("Shipped template: it must describe the topology this gate boots");
  // -------------------------------------------------------------------------
  for (const key of topologyKeys) {
    const templateSetting = templateValue(key);
    expect(
      `${productionTemplatePath} sets ${key} to the value the gate boots`,
      templateSetting === fixtureValue(key),
      `template: ${templateSetting === null ? "(absent)" : JSON.stringify(templateSetting)}, ` +
        `gate fixture: ${JSON.stringify(fixtureValue(key))}`,
    );
  }
  const templateRetryWindow = Number(templateValue(retryWindowKey));
  expect(
    `${productionTemplatePath} keeps ${retryWindowKey} above the worker budget`,
    Number.isFinite(templateRetryWindow) && templateRetryWindow >= retryWindowFloor,
    `template: ${templateValue(retryWindowKey) ?? "(absent)"}, floor: ${retryWindowFloor} seconds`,
  );

  // -------------------------------------------------------------------------
  section("Reset: start from a stack with no reused containers, volumes or trust material");
  // -------------------------------------------------------------------------
  const reset = compose(["down", "--volumes", "--remove-orphans"]);
  expect("the release stack can be reset", reset.status === 0, reset.output);

  // -------------------------------------------------------------------------
  section("Positive case: a valid production configuration must reach a serving worker");
  // -------------------------------------------------------------------------
  const up = compose(["up", "-d", "--build"]);
  teardownNeeded = true;

  if (expect("the production stack starts", up.status === 0, up.output)) {
    const health = waitForHealth(appService, bootTimeoutMs);
    expect(
      "the application container becomes healthy",
      health.healthy,
      health.healthy
        ? undefined
        : `last health status: ${health.status}\n${health.container ? containerLogs(health.container) : ""}`,
    );

    const logs = health.container === null ? "" : containerLogs(health.container);

    // Both lines only appear when the entrypoint's production branch runs: the
    // configuration is rebuilt from runtime secrets and then validated against
    // the database. A container that merely started cannot produce them.
    expect(
      "the entrypoint rebuilt the production configuration cache",
      logs.includes("Configuration cached successfully"),
      logs,
    );
    expect(
      "the entrypoint passed the release check before serving",
      logs.includes("Esquema del release y presupuestos de invitación comprobados"),
      logs,
    );

    // `healthy` is only meaningful if it cannot be satisfied without a serving
    // worker, so the probe is exercised directly rather than trusted.
    const probe = docker([
      "exec",
      health.container ?? "",
      "php",
      "-r",
      "exit((is_file('/tmp/uvh-config.php') && @fsockopen('127.0.0.1', 9000) !== false) ? 0 : 1);",
    ]);
    expect("the cached configuration exists and PHP-FPM is serving the request", probe.status === 0, probe.output);
  }

  // A valid non-default value has to be accepted, not only the default one. This
  // is the regression guard for bcrypt_rounds reaching the gate as a string:
  // environment values always arrive as strings, so without an explicit integer
  // cast every production start fails, including a perfectly valid one.
  const nonDefaultCost = composeRun(["BCRYPT_ROUNDS=14"], ["php", "artisan", "uvh:release-check"], lifecycleTimeoutMs);
  expect("a valid non-default BCRYPT_ROUNDS still boots", nonDefaultCost.status === 0, nonDefaultCost.output);

  // -------------------------------------------------------------------------
  section("Trust material: re-running the fixture must not break verified TLS");
  // -------------------------------------------------------------------------
  // PostgreSQL loads its key pair once at startup. If the certificate fixture
  // regenerated the CA on every start, the application would mount a CA the
  // running server has never seen, and connections would fail closed with an
  // opaque "certificate verify failed" instead of a diagnosable error.
  const certs = compose(["run", "--rm", "--no-deps", "certs"]);
  expect("the certificate fixture reuses existing material", certs.output.includes("Reusing ephemeral trust material"), certs.output);

  const afterCerts = composeRun([], ["php", "artisan", "uvh:release-check"], lifecycleTimeoutMs);
  expect("the release check still passes after the fixture re-runs", afterCerts.status === 0, afterCerts.output);

  // -------------------------------------------------------------------------
  section("Negative cases: one broken value must stop the container, for its own reason only");
  // -------------------------------------------------------------------------
  for (const testCase of configurationCases) {
    expectRefusal(testCase);
  }

  // -------------------------------------------------------------------------
  section("Schema negatives: a database the image cannot serve must stop every long-lived worker");
  // -------------------------------------------------------------------------
  const createEmpty = compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "uvh_release_boot",
    "-d",
    "postgres",
    "-c",
    `CREATE DATABASE ${emptyDatabase}`,
  ]);

  if (expect("an empty scratch database can be created", createEmpty.status === 0, createEmpty.output)) {
    const emptySchema = [`DB_DATABASE=${emptyDatabase}`];

    for (const [label, command] of [
      ["PHP-FPM", []],
      ["a queue worker", ["php", "artisan", "queue:work"]],
      ["the scheduler", ["php", "artisan", "schedule:work"]],
    ]) {
      expectRefusal({
        name: `${label} refuses to start against an empty schema`,
        overrides: emptySchema,
        command,
        output: missingSchema,
      });
    }

    // The gate must not make a deployment unrepairable: recovering from an empty
    // database is the whole reason the migration job stays ungated.
    const repair = composeRun(
      emptySchema,
      ["php", "artisan", "migrate", "--force", "--no-interaction"],
      lifecycleTimeoutMs,
    );
    expect("the explicit migration job still repairs an empty database", repair.status === 0, repair.output);
  }

  // Running the migration list twice has to stay a no-op, otherwise every
  // redeploy would be a schema event on a live database. This must happen while
  // the ledger is still intact: afterwards the newest migration is pending again
  // and re-running it would be a real migration rather than a no-op.
  const reMigrate = compose([
    "run",
    "--rm",
    "--no-deps",
    "--name",
    `${projectName}-assert-migrate`,
    "migrate",
  ]);
  expect("re-running the migration job is a no-op", reMigrate.status === 0, reMigrate.output);

  // Simulate a schema that is behind the image: the ledger keeps the table but
  // stops claiming the newest migration ran.
  const dropLedgerRow = compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "uvh_release_boot",
    "-d",
    mainDatabase,
    "-c",
    "delete from migrations where id = (select max(id) from migrations)",
  ]);

  if (expect("the migration ledger can be moved behind the image", dropLedgerRow.status === 0, dropLedgerRow.output)) {
    expectRefusal({
      name: "PHP-FPM refuses to start when the schema is behind the image",
      output: "migraciones pendientes",
    });
  }
} catch (error) {
  failures.push("the runner completed without an unexpected error");
  console.error("\n  FAIL  the runner completed without an unexpected error");
  console.error(`        | ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (teardownNeeded) {
    section("Teardown");
    const down = compose(["down", "--volumes", "--remove-orphans"]);
    expect("the release stack is removed, including its volumes", down.status === 0, down.output);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`  - ${failure}`);
  }
  process.exit(1);
}
console.log("Production boot contract satisfied.");
