#!/usr/bin/env node

// Escanea con Trivy cada imagen de terceros de la que depende el árbol, y
// decide la misma puerta que las imágenes que construye el repositorio: un
// CRITICAL con parche publicado bloquea.
//
// Existe porque la puerta de `release-e2e` sólo mira los dos artefactos que el
// repositorio compila. Las demás bases fijadas —Caddy, que es el borde de
// producción, PostgreSQL y Redis, que sostienen los ensayos— no las miraba
// nadie, y ahí puede vivir un hallazgo igual de real sin que ningún trabajo se
// enterara.
//
// La lista de imágenes no se escribe aquí: se le pide a
// `check-image-digests.mjs --references`, que es quien recorre el repositorio.
// Una lista propia en este fichero sería una segunda verdad, y la que se
// quedara atrás no fallaría: simplemente dejaría de mirar.
//
// Tres finales distintos, y no se mezclan:
//
//   - `clean`: el escaneo terminó y no queda ningún CRITICAL con parche.
//   - `findings`: hay al menos uno. Bloquea.
//   - `unresolved`: el registro no conoce esa referencia. Bloquea, igual que en
//     el chequeo de digests: un pin colgado se arregla antes de compilar.
//   - `unavailable`: no se pudo preguntar (red caída, límite de tasa del
//     registro, daemon ausente). No bloquea por defecto, porque un 429 de una
//     IP compartida no es un defecto del repositorio y convertir eso en rojo
//     enseña a ignorar la puerta. Se declara en el informe y en el resumen, y
//     `--fail-on-unavailable` lo convierte en fallo para quien prefiera que una
//     comprobación incompleta detenga la ejecución.
//
// Un cuarto final, que no es sobre una imagen sino sobre el fichero de
// supresiones: cada entrada de `vulnerabilities:` tiene que estar **usada por
// algún escaneo**, y la entrada que ya no suprime nada bloquea. Una excepción
// que no suprime nada no es inofensiva: es una excepción que nadie va a revisar
// porque parece aprobada.
//
// El juicio es **entrada por entrada**, no de la sección entera. Mirar el total
// dejaba que una entrada muerta se escondiera detrás de una viva —medido: con
// dos entradas vigentes y una tercera cuyo ámbito no existe en ninguna imagen,
// el veredicto era `in-use` y la puerta no decía nada— y basta añadir una
// segunda excepción para que la comprobación deje de mirar la primera.
//
// Y **exige que todos los escaneos hayan terminado**: si alguno quedó
// `unavailable`, que ninguna la usara no es un hallazgo, es una ausencia de
// medición, y declararla obsoleta presionaría para retirar una excepción que
// sigue siendo válida —concluir desde lo que no se miró es el fallo que esta
// puerta existe para evitar—. Un daemon ausente o un 429 no vuelven obsoleta una
// excepción: la dejan sin comprobar, y esa entrada sigue la política de
// `unavailable` (se declara, y sólo bloquea con `--fail-on-unavailable`).
//
// El veredicto se decide sobre el informe JSON, no sobre la tabla. La tabla lleva
// un `Total:` por objetivo y el resumen no siempre es el primero ni el último:
// leerla costó una clasificación equivocada en la primera corrida de esta
// herramienta, que dio por «no se pudo consultar» una imagen con doce CRITICAL
// porque el último objetivo de la tabla mostraba cero. El JSON dice lo mismo sin
// ambigüedad y además deja por escrito qué hallazgo es cada cosa.
//
// Uso:
//   node scripts/scan-pinned-images.mjs [--trivy=aquasec/trivy:0.74.0]
//     [--cache=DIR] [--json=image-bases.json] [--fail-on-unavailable] [--quiet]

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, value = ""] = entry.replace(/^--/, "").split("=", 2);
  return [key, value];
}));

const quiet = "quiet" in args;
const failOnUnavailable = "fail-on-unavailable" in args;
const jsonPath = typeof args.json === "string" ? args.json : "";
const trivyImage = typeof args.trivy === "string" && args.trivy !== ""
  ? args.trivy
  : (process.env.TRIVY_IMAGE || "aquasec/trivy:0.74.0");

// La caché de la base de datos de vulnerabilidades, fuera del repositorio
// cuando hay un directorio temporal de runner: cinco imágenes no tienen por qué
// descargar la base cinco veces, y el árbol de trabajo no es sitio para cachés.
const cacheDir = path.resolve(
  typeof args.cache === "string" && args.cache !== ""
    ? args.cache
    : path.join(process.env.RUNNER_TEMP || path.join(repositoryRoot, ".uvh-runtime"), "trivy-cache"),
);

const IGNORE_FILE = ".trivyignore.yaml";

const CRITICAL_AND_FIXED = ["--scanners", "vuln", "--severity", "CRITICAL", "--ignore-unfixed"];

const UNRESOLVED = /(manifest unknown|no such (?:image|host)|not found|pull access denied|denied)/i;
const UNAVAILABLE = /(too many requests|toomanyrequests|rate limit|dial tcp|i\/o timeout|connection refused|cannot connect to the docker daemon|no route to host|tls handshake|temporary failure|unauthorized)/i;

function unquote(value) {
  const trimmed = value.trim();

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

/**
 * Las entradas del fichero de supresiones, leídas como datos.
 *
 * La sección de vulnerabilidades se devuelve entrada por entrada porque el
 * veredicto se decide una a una: un contador de la sección no distinguiría la
 * excepción que sigue tapando algo de la que ya no tapa nada.
 */
function suppressionEntries(ignoreFile) {
  const entries = { misconfigurations: 0, vulnerabilities: [] };
  let section = "";
  let current = null;

  for (const line of ignoreFile.split("\n")) {
    const header = /^([a-z]+):\s*$/.exec(line);

    if (header) {
      section = header[1];
      current = null;

      continue;
    }

    const id = /^\s+- id:\s*(\S+)\s*$/.exec(line);

    if (id && section === "vulnerabilities") {
      current = { id: id[1], statement: "" };
      entries.vulnerabilities.push(current);

      continue;
    }

    if (id && section === "misconfigurations") {
      current = null;
      entries.misconfigurations += 1;

      continue;
    }

    const statement = /^\s+statement:\s*(.+?)\s*$/.exec(line);

    if (current !== null && statement) {
      current.statement = unquote(statement[1]);
    }
  }

  return entries;
}

/**
 * Si un hallazgo suprimido pertenece a una entrada concreta.
 *
 * El identificador es la vía directa, pero Trivy lo anida en `Finding` y no
 * siempre lo trae: el enunciado es la segunda, porque Trivy lo copia del fichero
 * de supresiones en el propio informe. Se compara un prefijo corto y no el texto
 * entero: el enunciado viaja truncado y una entrada larga nunca casaría.
 */
function entryUsed(entry, item) {
  if (item.id !== "" && item.id.toLowerCase() === entry.id.toLowerCase()) {
    return true;
  }

  const fingerprint = entry.statement.slice(0, 60);

  return fingerprint.length >= 24 && item.statement.startsWith(fingerprint);
}

/**
 * La lista de bases ajenas que el árbol fija. Si el chequeo de digests se niega
 * a imprimirla, el motivo se propaga: media lista escaneada es peor que ninguna,
 * porque se leería como «todo limpio».
 */
function pinnedReferences() {
  try {
    const output = execFileSync(
      process.execPath,
      [path.join(repositoryRoot, "scripts/check-image-digests.mjs"), "--offline", "--references"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
    );

    return output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  } catch (error) {
    const detail = `${error?.stderr ?? ""}${error?.stdout ?? ""}${error?.message ?? ""}`.trim();
    throw new Error(`no se pudo obtener la lista de bases fijadas: ${detail.split("\n").slice(0, 4).join(" ")}`);
  }
}

/**
 * Un escaneo por imagen, con la misma puerta que las imágenes del repositorio y
 * con `--show-suppressed`: una supresión vigente tiene que verse en el registro
 * de la ejecución, no sólo en el fichero que la declara.
 *
 * `--show-suppressed` saca lo suprimido en `Results[].ExperimentalModifiedFindings`
 * con `Status: ignored`, que es de donde se cuenta lo que sigue vigente; sin él,
 * una supresión que ya no tapa nada pasaría por aprobada.
 */
function scan(reference) {
  const command = [
    "run", "--rm",
    "-v", `${repositoryRoot}:/repo:ro`,
    "-v", `${cacheDir}:/root/.cache/trivy`,
    "-e", "TRIVY_CACHE_DIR=/root/.cache/trivy",
    trivyImage,
    "image",
    "--quiet",
    "--image-src", "remote",
    ...CRITICAL_AND_FIXED,
    "--ignorefile", `/repo/${IGNORE_FILE}`,
    "--show-suppressed",
    "--format", "json",
    "--no-progress",
    "--exit-code", "1",
    reference,
  ];

  let stdout = "";
  let stderr = "";
  let status = 0;

  try {
    stdout = execFileSync("docker", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
  } catch (error) {
    stdout = `${error?.stdout ?? ""}`;
    stderr = `${error?.stderr ?? ""}`;
    status = typeof error?.status === "number" ? error.status : 1;
  }

  const detail = stderr.split("\n").map((line) => line.trim()).filter((line) => line !== "").slice(-3).join(" ").slice(0, 400);
  const inconclusive = (kind, why) => ({ status: kind, critical: 0, suppressed: 0, findings: [], ignored: [], detail: why });

  let report = null;

  try {
    report = JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    report = null;
  }

  // Sin informe no hay veredicto. Se distinguen las dos razones por las que
  // puede faltar: el registro no conoce la referencia (un pin colgado, que se
  // arregla antes de compilar) o no se pudo preguntar (red, límite de tasa).
  if (report === null || !Array.isArray(report.Results)) {
    const combined = `${stdout}\n${stderr}`;

    return inconclusive(
      UNRESOLVED.test(combined) ? "unresolved" : "unavailable",
      detail || `docker salió con ${status} sin un informe de Trivy reconocible`,
    );
  }

  const findings = [];
  const ignored = [];

  for (const result of report.Results) {
    for (const vulnerability of result.Vulnerabilities ?? []) {
      findings.push({
        id: vulnerability.VulnerabilityID,
        package: vulnerability.PkgName,
        target: result.Target,
        installed: vulnerability.InstalledVersion,
        fixed: vulnerability.FixedVersion,
      });
    }

    for (const modified of result.ExperimentalModifiedFindings ?? []) {
      if (modified.Status === "ignored") {
        ignored.push({
          id: modified.Finding?.VulnerabilityID ?? modified.VulnerabilityID ?? "",
          target: result.Target,
          statement: `${modified.Statement ?? ""}`.slice(0, 200),
        });
      }
    }
  }

  if (findings.length > 0) {
    return { status: "findings", critical: findings.length, suppressed: ignored.length, findings, ignored, detail: "" };
  }

  // Salir con 1 y no traer ningún hallazgo no es «limpio»: es un resultado que
  // no se entiende, y darlo por bueno convertiría la puerta en un adorno.
  if (status !== 0) {
    return inconclusive("unavailable", detail || `el escaneo salió con ${status} y el informe no trae ningún hallazgo activo`);
  }

  return { status: "clean", critical: 0, suppressed: ignored.length, findings, ignored, detail: "" };
}

const ignoreFile = readFileSync(path.join(repositoryRoot, IGNORE_FILE), "utf8");
const entries = suppressionEntries(ignoreFile);
const references = pinnedReferences();

if (references.length === 0) {
  throw new Error("el árbol no declara ninguna base ajena: el escaneo no estaría mirando nada");
}

mkdirSync(cacheDir, { recursive: true });

const results = [];

for (const reference of references) {
  const result = scan(reference);
  results.push({ reference, ...result });

  if (!quiet) {
    const note = result.status === "clean"
      ? (result.suppressed > 0 ? `${result.suppressed} supresión vigente` : "sin hallazgos ni supresiones")
      : (result.detail || `${result.critical} CRITICAL con parche`);

    process.stdout.write(`${result.status.padEnd(12)} ${reference} — ${note}\n`);
  }
}

const findings = results.filter((result) => result.status === "findings");
const unresolved = results.filter((result) => result.status === "unresolved");
const unavailable = results.filter((result) => result.status === "unavailable");
const suppressed = results.reduce((total, result) => total + result.suppressed, 0);

// Sólo un escaneo con informe puede usar una entrada: `unresolved` no trae
// informe de la imagen y no dice nada sobre lo que esa imagen contiene.
const conclusive = results.filter((result) => result.status === "clean" || result.status === "findings");
const allConclusive = conclusive.length === results.length;

// Una entrada que no suprime nada es una excepción que se lee como aprobada y
// que ya no cubre ningún hallazgo: o sobra, o su ámbito quedó sin efecto. La
// conclusión se alcanza sólo cuando hubo informe de todas las imágenes.
const observed = new Set();

for (const result of conclusive) {
  for (const item of result.ignored) {
    for (const entry of entries.vulnerabilities) {
      if (entryUsed(entry, item)) {
        observed.add(entry.id.toLowerCase());
      }
    }
  }
}

const unusedEntries = entries.vulnerabilities.filter((entry) => !observed.has(entry.id.toLowerCase()));
const staleEntries = allConclusive ? unusedEntries : [];
const uncheckedEntries = allConclusive ? [] : unusedEntries;

const suppressionVerdict = entries.vulnerabilities.length === 0
  ? "none"
  : (unusedEntries.length === 0 ? "in-use" : (allConclusive ? "stale" : "unchecked"));

const failures = [
  ...findings.map((result) => ({
    kind: "findings",
    reference: result.reference,
    detail: `${result.critical} CRITICAL con parche publicado (${result.findings.slice(0, 4).map((finding) => finding.id).join(", ")}`
      + `${result.critical > 4 ? ", …" : ""}): la misma puerta que las imágenes del repositorio`,
  })),
  ...unresolved.map((result) => ({
    kind: "unresolved",
    reference: result.reference,
    detail: result.detail || "el registro no conoce la referencia fijada",
  })),
  ...staleEntries.map((entry) => ({
    kind: "stale-suppression",
    reference: IGNORE_FILE,
    detail: `la entrada ${entry.id} no la usó ningún escaneo de las ${results.length} bases: revisar el ámbito o retirarla`,
  })),
  ...(failOnUnavailable
    ? [
      ...unavailable.map((result) => ({ kind: "unavailable", reference: result.reference, detail: result.detail })),
      ...uncheckedEntries.map((entry) => ({
        kind: "unchecked-suppression",
        reference: IGNORE_FILE,
        detail: `la entrada ${entry.id} no se pudo comprobar: ${results.length - conclusive.length} de ${results.length} escaneos no llegaron a ejecutarse`,
      })),
    ]
    : []),
];

if (!quiet) {
  process.stdout.write(
    `\n${results.length} bases ajenas escaneadas, ${entries.vulnerabilities.length} supresión(es) de vulnerabilidad declarada(s), `
    + `${entries.vulnerabilities.length - unusedEntries.length} usada(s): ${findings.length} con hallazgos, `
    + `${unresolved.length} sin resolver, ${unavailable.length} sin poder consultar\n`,
  );

  if (uncheckedEntries.length > 0) {
    process.stdout.write(
      `${uncheckedEntries.map((entry) => entry.id).join(", ")}: sin informe de todas las imágenes, «ningún escaneo la usó» `
      + "no distingue una entrada obsoleta de una que no se llegó a medir\n",
    );
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((result) => `| \`${result.reference}\` | ${result.status} | ${result.critical} | ${result.suppressed} |`);
  const notes = unavailable.map((result) => `- \`${result.reference}\`: ${result.detail}`);

  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Bases ajenas escaneadas",
      "",
      "| imagen | estado | CRITICAL con parche | supresiones vigentes |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      ...(notes.length > 0 ? ["No se pudo consultar:", "", ...notes, ""] : []),
      `${findings.length} con hallazgos, ${unresolved.length} sin resolver, ${unavailable.length} sin poder consultar.`,
      "",
    ].join("\n"),
  );
}

const artifact = {
  schema: "uvh-image-bases/1",
  generatedAt: new Date().toISOString(),
  trivy: trivyImage,
  gate: [...CRITICAL_AND_FIXED, "--ignorefile", IGNORE_FILE, "--exit-code 1"],
  ignoreFile: {
    misconfigurations: entries.misconfigurations,
    vulnerabilities: entries.vulnerabilities.length,
    suppressed,
    verdict: suppressionVerdict,
    entries: entries.vulnerabilities.map((entry) => ({ id: entry.id, used: observed.has(entry.id.toLowerCase()) })),
  },
  images: results,
  failures,
  unavailable: unavailable.map((result) => ({ reference: result.reference, detail: result.detail })),
};

if (jsonPath !== "") {
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.kind}: ${failure.reference} — ${failure.detail}\n`);
  }

  process.exit(1);
}

process.exit(0);
