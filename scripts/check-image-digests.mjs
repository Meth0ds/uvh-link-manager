#!/usr/bin/env node

// Comprueba que cada imagen de terceros de la que depende el despliegue está
// fijada por digest, que ese digest sigue existiendo en el registro y que la
// etiqueta no ha avanzado hacia otro sitio.
//
// Las tres preguntas son distintas y cada una falla de una forma distinta:
//
//   - Sin digest, la compilación de hoy y la de mañana pueden traer bases
//     distintas con el mismo código (`unpinned`). Falla siempre.
//   - Con un digest que ya no resuelve, la compilación se rompe, y quien se
//     entera es el despliegue. Falla siempre. Sólo se comprueba por separado
//     cuando la etiqueta ha derivado: mientras la etiqueta apunte al digest
//     fijado, ese digest existe por definición.
//   - Con un digest correcto pero una etiqueta que ya apunta a otra parte, no
//     falta nada: falta una decisión. Se avisa (`drift`) y se puede convertir en
//     puerta con `--strict-drift`.
//
// La tercera no bloquea porque un parche publicado en la base no es un defecto
// del repositorio: es una actualización pendiente, y quien la aprueba es una
// persona. La segunda sí, porque un pin colgado no se arregla revisando: se
// arregla antes de compilar.
//
// El registro se consulta con `docker buildx imagetools inspect`, que habla el
// API del registro sin necesidad de un daemon. Si el registro limita por tasa o
// no responde (`unavailable`) no se declara ninguna imagen mala: se informa.
// Convertir un 429 compartido en una puerta roja enseña a ignorar la puerta, y
// el resultado de una puerta que se ignora es peor que no tenerla. Con
// `--fail-on-unavailable` ese caso también falla, para quien prefiera que una
// comprobación incompleta detenga la ejecución.
//
// `--references` no comprueba nada: imprime la lista de bases ajenas que el
// árbol fija, una por línea, para que otro trabajo la recorra sin repetir el
// recorrido del repositorio. Es la única fuente de esa lista, y por eso no
// acepta una lista parcial: si algún pin del árbol no se puede auditar, se
// niega a imprimir en vez de entregar la mitad de las imágenes como si fueran
// todas.
//
// Uso:
//   node scripts/check-image-digests.mjs [--offline] [--strict-drift]
//     [--fail-on-unavailable] [--json=image-digests.json] [--quiet]
//     [--references]

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, value = ""] = entry.replace(/^--/, "").split("=", 2);
  return [key, value];
}));

const offline = "offline" in args;
const referencesOnly = "references" in args;
const strictDrift = "strict-drift" in args;
const failOnUnavailable = "fail-on-unavailable" in args;
const quiet = "quiet" in args;
const jsonPath = typeof args.json === "string" ? args.json : "";

// Directorios sin artefacto revisable: dependencias instaladas, el índice de
// Git y la caché local de PHPStan. Recorrerlos sólo haría lento el chequeo.
const SKIP = new Set(["vendor", "node_modules", ".git", ".angular", ".uvh-runtime", "storage"]);

// Imágenes que construye este repositorio: no hay digest que fijar. El prefijo
// es la regla, y el test de contrato es lo que impide que una imagen ajena lo
// adopte para saltarse este chequeo.
const LOCAL_PREFIX = "uvh-";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function walk(directory, matches = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        walk(path.join(directory, entry.name), matches);
      }

      continue;
    }

    matches.push(path.relative(repositoryRoot, path.join(directory, entry.name)).replaceAll("\\", "/"));
  }

  return matches;
}

const files = walk(repositoryRoot);
const dockerfiles = files.filter((file) => /dockerfile/i.test(path.basename(file))).sort();
const composeFiles = readdirSync(repositoryRoot)
  .filter((entry) => /^docker-compose.*\.ya?ml$/.test(entry))
  .sort();

if (dockerfiles.length === 0 || composeFiles.length === 0) {
  throw new Error("No se encontraron Dockerfiles o ficheros de compose: el chequeo no está mirando el árbol del repositorio");
}

// Sin esto, una herramienta ausente se leería como «ninguna imagen mala» y el
// trabajo quedaría verde sin haber comprobado nada. La lista de referencias no
// pregunta al registro, así que no la necesita.
if (!offline && !referencesOnly) {
  try {
    execFileSync("docker", ["buildx", "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("`docker buildx` no está disponible: sin él no se puede preguntar al registro. Use --offline para comprobar sólo la forma de los pines");
  }
}

function lines(file) {
  return readFileSync(path.join(repositoryRoot, file), "utf8").replaceAll("\r\n", "\n").split("\n");
}

/**
 * Todas las referencias a una imagen, con el fichero y la línea que las declara.
 * Cubre `FROM`, `COPY --from=` (que no es una etapa) y los `image:` de compose.
 */
function references() {
  const found = [];

  for (const file of dockerfiles) {
    const source = lines(file);

    const stages = source
      .map((line) => /^\s*FROM\s+\S+(?:\s+--\S+)*\s+AS\s+(\S+)\s*$/i.exec(line))
      .filter(Boolean)
      .map((match) => match[1].toLowerCase());

    source.forEach((line, index) => {
      const from = /^\s*FROM\s+(.+?)\s*$/i.exec(line);

      if (from) {
        const token = from[1].split(/\s+AS\s+/i)[0].trim().replace(/^(?:--\S+\s+)+/, "");
        found.push({ file, line: index + 1, reference: token });

        return;
      }

      const copy = /--from=(\S+)/.exec(line);

      if (copy && !stages.includes(copy[1].toLowerCase())) {
        found.push({ file, line: index + 1, reference: copy[1] });
      }
    });
  }

  for (const file of composeFiles) {
    lines(file).forEach((line, index) => {
      const image = /^\s*image:\s*(\S+)\s*$/.exec(line);

      if (image) {
        found.push({ file, line: index + 1, reference: image[1] });
      }
    });
  }

  return found;
}

/**
 * `name[:tag][@sha256:...]`, partido a mano en vez de con una expresión regular
 * de nombre: el registro puede llevar puerto (`host:5000/ruta/imagen`) y ahí el
 * primer `:` no separa la etiqueta.
 */
function parse(reference) {
  const at = reference.indexOf("@");
  const withoutDigest = at === -1 ? reference : reference.slice(0, at);
  const digest = at === -1 ? "" : reference.slice(at + 1);
  const colon = withoutDigest.indexOf(":", withoutDigest.lastIndexOf("/"));
  const name = colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);

  return {
    name,
    tag: colon === -1 ? "" : withoutDigest.slice(colon + 1),
    digest,
  };
}

const PINNED_REJECTIONS = [];

const references_ = references().map((entry) => {
  const parts = parse(entry.reference);
  const local = parts.name.startsWith(LOCAL_PREFIX);
  const problems = [];

  if (entry.reference.includes("$")) {
    problems.push("la referencia es una variable: no se puede fijar ni auditar");
  } else if (parts.name === "" || /\s/.test(parts.name)) {
    problems.push("no es una referencia de imagen");
  } else if (!local) {
    if (parts.tag === "") {
      problems.push("sin etiqueta: quedaría como `latest`");
    }

    if (parts.digest === "") {
      problems.push("sin digest: la base sería lo que signifique la etiqueta el día de la compilación");
    } else if (!DIGEST.test(parts.digest)) {
      problems.push(`el digest no tiene forma de sha256: '${parts.digest}'`);
    }
  } else if (parts.digest !== "") {
    problems.push("una imagen construida aquí no puede llevar digest de registro");
  }

  if (problems.length > 0) {
    PINNED_REJECTIONS.push({ ...entry, problems });
  }

  return { ...entry, ...parts, local };
});

// El mismo `name:tag` tiene que resolver al mismo digest en todos los ficheros:
// dos valores distintos significan que la base que arranca depende del fichero.
const byReference = new Map();

for (const entry of references_.filter((item) => !item.local && item.tag !== "" && DIGEST.test(item.digest))) {
  const key = `${entry.name}:${entry.tag}`;
  const known = byReference.get(key);

  if (known === undefined) {
    byReference.set(key, { name: entry.name, tag: entry.tag, digest: entry.digest, sites: [] });
  } else if (known.digest !== entry.digest) {
    PINNED_REJECTIONS.push({
      file: entry.file,
      line: entry.line,
      reference: entry.reference,
      problems: [`${key} ya está fijada como ${known.digest} en ${known.sites[0]}`],
    });
  }

  byReference.get(key).sites.push(`${entry.file}:${entry.line}`);
}

const images = [...byReference.values()].sort((a, b) => `${a.name}:${a.tag}`.localeCompare(`${b.name}:${b.tag}`));

if (referencesOnly) {
  // Una referencia sin fijar significa que la lista estaría incompleta, y una
  // lista incompleta de la que alguien escanea es peor que no escanear: diría
  // «todo limpio» sobre lo que no miró.
  if (PINNED_REJECTIONS.length > 0) {
    for (const rejection of PINNED_REJECTIONS) {
      process.stderr.write(`unpinned: ${rejection.file}:${rejection.line} ${rejection.reference} — ${rejection.problems.join("; ")}\n`);
    }

    process.exit(1);
  }

  // Las imágenes que construye este repositorio no están aquí: las escanea el
  // trabajo que las compila, sobre el artefacto real y no sobre la base.
  for (const image of images) {
    process.stdout.write(`${image.name}:${image.tag}@${image.digest}\n`);
  }

  process.exit(0);
}

const ATTEMPTS = 4;
const BACKOFF_MS = [2000, 5000, 15000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nombres que el API de Docker Hub atiende. Un primer segmento sin punto ni
// dos puntos es un namespace de Hub (`library/php` o `php`); con punto es un
// registro distinto, y con dos puntos, un puerto.
function isDockerHub(name) {
  const first = name.split("/")[0];

  return !first.includes(".") && !first.includes(":") && first !== "localhost";
}

/**
 * Digest de una etiqueta según el API público de Docker Hub.
 *
 * Es la segunda vía, no un atajo: el registro y el API de Hub limitan por tasa
 * de forma independiente, así que un 429 en uno no dice nada del otro. Sin esta
 * alternativa, la puerta se convierte en un aviso permanente en cuanto la IP de
 * salida es compartida (un runner de CI lo es) y el pin deja de verificarse sin
 * que nadie lo note.
 */
async function hubTagDigest(name, tag) {
  const repository = name.includes("/") ? name : `library/${name}`;

  try {
    const response = await fetch(`https://hub.docker.com/v2/repositories/${repository}/tags/${tag}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "uvh-digest-integrity/1.0" },
    });

    if (response.status === 404) {
      return { status: "unresolved", digest: "", detail: `Docker Hub no conoce ${repository}:${tag}` };
    }

    if (!response.ok) {
      return { status: "unavailable", digest: "", detail: `Docker Hub respondi\u00f3 ${response.status} para ${repository}:${tag}` };
    }

    const body = await response.json();

    return DIGEST.test(body?.digest ?? "")
      ? { status: "ok", digest: body.digest, detail: "" }
      : { status: "unavailable", digest: "", detail: `Docker Hub no devolvi\u00f3 un digest para ${repository}:${tag}` };
  } catch (error) {
    return { status: "unavailable", digest: "", detail: `${error?.message ?? error}`.slice(0, 200) };
  }
}

/**
 * Resuelve una referencia a su digest con el registro. Devuelve
 * `{ status, digest, detail }`, donde `status` es `ok`, `unresolved` (el
 * registro responde que eso no existe) o `unavailable` (no se pudo preguntar).
 */
async function cliDigest(reference) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const output = execFileSync(
        "docker",
        ["buildx", "imagetools", "inspect", reference, "--format", "{{.Manifest.Digest}}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
      ).trim();

      return DIGEST.test(output)
        ? { status: "ok", digest: output, detail: "" }
        : { status: "unresolved", digest: "", detail: `el registro no devolvió un digest para ${reference}: '${output}'` };
    } catch (error) {
      const detail = `${error?.stderr ?? ""}${error?.stdout ?? ""}${error?.message ?? ""}`.trim();
      const lowered = detail.toLowerCase();
      const notFound = /(manifest unknown|not found|404|denied|unauthorized|forbidden)/.test(lowered);
      const retryable = /(429|too many requests|toomanyrequests|5\d\d|econnreset|etimedout|timeout|socket hang up)/.test(lowered);

      // Un `not found` no se reintenta: esperar no lo convierte en existente.
      const last = attempt === ATTEMPTS - 1;

      if (notFound || last) {
        return {
          status: notFound ? "unresolved" : "unavailable",
          digest: "",
          detail: detail.split("\n").slice(0, 3).join(" ").slice(0, 400),
        };
      }

      if (!retryable && attempt >= 1) {
        return { status: "unavailable", digest: "", detail: detail.split("\n").slice(0, 3).join(" ").slice(0, 400) };
      }

      if (!quiet) {
        process.stdout.write(`  reintento ${attempt + 1}/${ATTEMPTS - 1} para ${reference}\n`);
      }

      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }

  return { status: "unavailable", digest: "", detail: `no se pudo consultar ${reference}` };
}

/**
 * Resuelve `name:tag` (o un digest fijado) probando las vías disponibles. La
 * fuente que contestó queda en el informe: una comprobación que no dice cómo se
 * obtuvo no se puede auditar.
 */
async function resolve(reference) {
  const { name, tag } = parse(reference);

  // Un digest concreto sólo lo puede confirmar el registro: el API de Hub
  // busca por etiqueta.
  const strategies = reference.includes("@") || !isDockerHub(name)
    ? [["registry", () => cliDigest(reference)]]
    : [["hub", () => hubTagDigest(name, tag)], ["registry", () => cliDigest(reference)]];

  let last = { status: "unavailable", digest: "", detail: `no se pudo consultar ${reference}` };

  for (const [source, strategy] of strategies) {
    const result = await strategy();
    last = { ...result, source };

    if (result.status !== "unavailable") {
      return last;
    }
  }

  return last;
}

const report = [];

for (const image of images) {
  const reference = `${image.name}:${image.tag}`;

  if (offline) {
    report.push({ ...image, tagDigest: "", source: "offline", status: "unpinned-only", detail: "" });

    continue;
  }

  // Primero la etiqueta, que responde a las dos preguntas a la vez: si hoy
  // apunta al digest fijado, ese digest existe por definición y no hace falta
  // preguntar por él. Sólo cuando ha derivado hay que comprobar si el pin sigue
  // resolviendo, porque entonces «deriva» y «colgado» son cosas distintas.
  const tag = await resolve(reference);
  let status = tag.status;
  let detail = tag.detail;
  let source = tag.source;
  let pinVerified = true;

  if (tag.status === "ok" && tag.digest !== image.digest) {
    // La discrepancia ya es un hecho conocido: la etiqueta de hoy no es la
    // fijada. Lo único que queda por averiguar es si el pin además quedó
    // colgado, y eso sí es una diferencia de urgencia. Si el registro no deja
    // comprobarlo, se informa de la deriva sin fingir que el pin está sano:
    // `pinVerified` es lo que separa «actualización pendiente» de «no lo sé».
    const pinned = await resolve(`${image.name}@${image.digest}`);
    status = pinned.status === "unresolved" ? "unresolved" : "drift";
    pinVerified = pinned.status === "ok";
    detail = pinned.status === "ok" ? "" : pinned.detail;
    source = `${tag.source}+${pinned.source}`;
  }

  report.push({
    ...image,
    tagDigest: tag.digest,
    status,
    pinVerified,
    source,
    detail,
  });
}

const failures = [
  ...PINNED_REJECTIONS.map((entry) => ({
    kind: "unpinned",
    where: `${entry.file}:${entry.line}`,
    reference: entry.reference,
    detail: entry.problems.join("; "),
  })),
  ...report
    .filter((image) => image.status === "unresolved")
    .map((image) => ({
      kind: "unresolved",
      where: image.sites.join(", "),
      reference: `${image.name}:${image.tag}@${image.digest}`,
      detail: image.detail || "el digest fijado no resuelve en el registro",
    })),
];

const drifted = report.filter((image) => image.status === "drift");
const unavailable = report.filter((image) => image.status === "unavailable");

if (strictDrift) {
  failures.push(...drifted.map((image) => ({
    kind: "drift",
    where: image.sites.join(", "),
    reference: `${image.name}:${image.tag}`,
    detail: `la etiqueta apunta ahora a ${image.tagDigest}` + (image.pinVerified ? "" : `, y el digest fijado no se pudo comprobar: ${image.detail}`),
  })));
}

if (failOnUnavailable) {
  failures.push(...unavailable.map((image) => ({
    kind: "unavailable",
    where: image.sites.join(", "),
    reference: `${image.name}:${image.tag}`,
    detail: image.detail || "no se pudo consultar el registro",
  })));
}

if (!quiet) {
  for (const rejection of PINNED_REJECTIONS) {
    process.stdout.write(`unpinned     ${rejection.file}:${rejection.line}  ${rejection.reference}\n`);
    for (const problem of rejection.problems) {
      process.stdout.write(`             ${problem}\n`);
    }
  }

  for (const image of report) {
    const reference = `${image.name}:${image.tag}`;
    const sites = image.sites.length > 1 ? ` (${image.sites.length} sitios)` : "";

    if (image.status === "ok") {
      process.stdout.write(`ok           ${reference}@${image.digest}${sites}\n`);
    } else if (image.status === "drift") {
      const caveat = image.pinVerified ? "actualización pendiente, no un defecto" : `no se pudo confirmar que el digest fijado siga existiendo (${image.detail})`;
      process.stdout.write(`drift        ${reference}${sites}: fijada ${image.digest}, hoy ${image.tagDigest} — ${caveat}\n`);
    } else if (image.status === "unpinned-only") {
      process.stdout.write(`sin verificar ${reference}@${image.digest} (--offline)\n`);
    } else {
      process.stdout.write(`${image.status.padEnd(12)} ${reference}${sites}: ${image.detail}\n`);
    }
  }

  process.stdout.write(`\n${images.length} imágenes fijadas, ${references_.length} referencias, ${failures.length} fallos, ${drifted.length} derivas, ${unavailable.length} sin poder consultar\n`);
}

const artifact = {
  schema: "uvh-image-digests/1",
  generatedAt: new Date().toISOString(),
  offline,
  dockerfiles,
  composeFiles,
  images: report.map((image) => ({
    reference: `${image.name}:${image.tag}`,
    digest: image.digest,
    tagDigest: image.tagDigest,
    source: image.source,
    pinVerified: image.pinVerified,
    sites: image.sites,
    status: image.status,
  })),
  failures,
  drift: drifted.map((image) => ({ reference: `${image.name}:${image.tag}`, pinned: image.digest, tag: image.tagDigest, pinVerified: image.pinVerified })),
  unavailable: unavailable.map((image) => ({ reference: `${image.name}:${image.tag}`, detail: image.detail })),
};

if (jsonPath !== "") {
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const table = [
    "| imagen | digest fijado | estado |",
    "| --- | --- | --- |",
    ...report.map((image) => `| \`${image.name}:${image.tag}\` | \`${image.digest}\` | ${image.status} |`),
    ...PINNED_REJECTIONS.map((entry) => `| \`${entry.reference}\` | — | ${entry.problems.join("; ")} |`),
  ].join("\n");

  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Digests de imágenes\n\n${table}\n\n${failures.length} fallos, ${drifted.length} derivas, ${unavailable.length} sin poder consultar.\n`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.kind}: ${failure.where} ${failure.reference} — ${failure.detail}\n`);
  }

  process.exit(1);
}

process.exit(0);
