#!/usr/bin/env node

// La mitad reproducible de la CI, en un solo comando y contra este árbol de
// trabajo: los dos trabajos de `.github/workflows/ci.yml` que juzgan un cambio
// de código —`frontend` y `backend`—, paso por paso y en su orden.
//
// Los otros siete trabajos **no** están aquí, y decir cuáles es parte del
// contrato: `e2e`, `async-e2e`, `release-e2e`, `boot-contract`, `backup-drills`,
// `digest-integrity` e `image-bases` levantan navegadores, imágenes de
// producción y servicios durante decenas de minutos cada uno. Este script no
// declara haberlos pasado: cada uno tiene su propia entrada (`npm run e2e`,
// `npm run e2e:async`, `npm run release:e2e`, `npm run release:boot`,
// `npm run e2e:backup`, `node scripts/check-image-digests.mjs`,
// `node scripts/scan-pinned-images.mjs`). Un trabajo que no se ejecutó no se
// declara verde.
//
// Existe porque la CI de este repositorio no puede ejecutar sus jobs: la cuenta
// de GitHub está bloqueada por facturación, así que cada job aparece `failure`
// con `steps: []` y la anotación "The job was not started because your account
// is locked due to a billing issue". Mientras eso siga así, "verificado en
// local" tiene que nombrar la lista exacta de comprobaciones y poder repetirse
// sin leer un runbook: una afirmación de validación que nadie puede reproducir
// no es evidencia.
//
// El orden es el de la CI y se detiene en el primer fallo, porque un paso rojo
// invalida lo que venga detrás: no se ejecuta PHPUnit sobre un árbol que no pasa
// Pint ni Larastan, y no se compila un frontend que no pasa Karma.
//
// La instalación va dentro (`npm ci`, `composer install`) porque la CI la hace
// y sin ella «checkout limpio + este script» no reproduce nada: se validarían
// un `node_modules` y un `vendor` viejos, y el árbol daría verde con
// dependencias que un checkout fresco no instalaría.
//
// Las pruebas de backend **son destructivas** para la base objetivo y el guard
// de `TestCase` exige un nombre terminado en `_test`. Por eso el destino es
// `uvh_test`, se migra desde cero (igual que la CI, para que el esquema exista
// completo antes del primer caso) y no se acepta ningún otro nombre.
//
// Uso:
//   node scripts/verify-local.mjs [--only=frontend|backend] [--skip-build]
//                                 [--compose-file=<ruta>] [--env-file=<ruta>]
//
// Sin `--only` se ejecutan las dos mitades. Si el daemon de Docker no está
// disponible, la mitad de backend falla con ese motivo explícito en vez de
// declararse verde por omisión: un paso que no se ejecutó nunca es un paso
// desconocido, y darlo por bueno es la forma de convertir esta puerta en un
// trámite.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function flag(name) {
  const prefix = `--${name}=`;

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const only = flag("only");
if (only !== null && only !== "frontend" && only !== "backend") {
  process.stderr.write(`--only sólo acepta frontend o backend, no ${JSON.stringify(only)}\n`);
  process.exit(2);
}

const skipBuild = process.argv.includes("--skip-build");
const composeFile = flag("compose-file") ?? "docker-compose.local.yml";
const envFile = flag("env-file") ?? ".env.docker.local";

/** Cómo se ejecuta la suite de Karma: la CI trae Chrome en el runner, macOS no. */
function chromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  return existsSync(macChrome) ? macChrome : "";
}

const steps = [
  {
    half: "frontend",
    name: "Frontend / instalación desde el lockfile",
    command: "npm",
    args: ["ci"],
    cwd: join(root, "frontend"),
  },
  {
    half: "frontend",
    name: "Frontend / audit de dependencias",
    command: "npm",
    args: ["audit", "--audit-level=moderate"],
    cwd: join(root, "frontend"),
  },
  {
    half: "frontend",
    name: "Frontend / lint",
    command: "npm",
    args: ["run", "lint"],
    cwd: join(root, "frontend"),
  },
  {
    half: "frontend",
    name: "Frontend / typecheck",
    command: "npm",
    args: ["run", "typecheck"],
    cwd: join(root, "frontend"),
  },
  {
    half: "frontend",
    name: "Frontend / tests (Chrome Headless)",
    command: "npm",
    args: ["test", "--", "--watch=false", "--browsers=ChromeHeadless"],
    cwd: join(root, "frontend"),
    env: { CHROME_BIN: chromeBin() },
  },
  {
    half: "frontend",
    name: "Frontend / build",
    command: "npm",
    args: ["run", "build"],
    cwd: join(root, "frontend"),
    skip: skipBuild,
  },
  {
    half: "backend",
    name: "Backend / composer validate",
    compose: ["run", "--rm", "php", "composer", "validate", "--strict", "--no-check-publish"],
  },
  {
    half: "backend",
    name: "Backend / instalación desde el lockfile",
    compose: ["run", "--rm", "php", "composer", "install", "--no-interaction", "--prefer-dist", "--no-progress"],
  },
  {
    half: "backend",
    name: "Backend / audit del árbol bloqueado",
    compose: ["run", "--rm", "php", "composer", "audit", "--locked"],
  },
  {
    half: "backend",
    name: "Backend / Pint + Larastan",
    compose: ["run", "--rm", "php", "composer", "quality"],
  },
  {
    half: "backend",
    name: "Backend / esquema aislado uvh_test",
    compose: ["run", "--rm", "-e", "DB_DATABASE=uvh_test", "php", "php", "artisan", "migrate:fresh", "--force", "--no-interaction"],
  },
  {
    half: "backend",
    name: "Backend / PHPUnit",
    compose: ["run", "--rm", "-e", "DB_DATABASE=uvh_test", "php", "composer", "test"],
  },
];

function run(step) {
  const command =
    step.compose === undefined
      ? { command: step.command, args: step.args }
      : {
          command: "docker",
          args: ["compose", "-f", composeFile, "--env-file", envFile, ...step.compose],
        };

  process.stdout.write(`\n▶ ${step.name}\n`);

  const result = spawnSync(command.command, command.args, {
    cwd: step.cwd ?? root,
    env: { ...process.env, ...(step.env ?? {}) },
    stdio: "inherit",
  });

  if (result.error) {
    process.stderr.write(`✗ ${step.name}: ${result.error.message}\n`);

    return false;
  }

  if (result.status !== 0) {
    process.stderr.write(`✗ ${step.name} (código ${result.status})\n`);

    return false;
  }

  return true;
}

function dockerIsUp() {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore" });

  return !probe.error && probe.status === 0;
}

const selected = steps.filter((step) => (only === null || step.half === only) && !step.skip);

if (selected.some((step) => step.half === "backend") && !dockerIsUp()) {
  process.stderr.write(
    "✗ El daemon de Docker no responde: la mitad de backend no se puede ejecutar.\n" +
      "  Arranca Docker y repite, o usa --only=frontend para verificar sólo el frontend.\n" +
      "  Un paso que no se ejecutó no se declara verde.\n",
  );
  process.exit(1);
}

const failed = [];
for (const step of selected) {
  if (!run(step)) {
    failed.push(step.name);
    break;
  }
}

process.stdout.write(
  failed.length === 0
    ? `\n✓ ${selected.length} comprobaciones en verde\n`
    : `\n✗ detenido en: ${failed[0]}\n`,
);

process.exit(failed.length === 0 ? 0 : 1);
