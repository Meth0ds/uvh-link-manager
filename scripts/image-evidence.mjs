#!/usr/bin/env node

// Escribe el expediente de las imágenes que se acaban de construir y escanear:
// la identidad del artefacto (id de contenido, tamaño, fecha, digests de
// registro si los tiene), las bases fijadas de las que salió, y el resumen del
// SBOM y del escaneo, con el sha256 de cada informe.
//
// Existe por una razón concreta: un expediente que dice «se escaneó la imagen»
// no sirve para decidir una promoción. Lo que sirve es atar el artefacto al
// documento —el id de la imagen, el digest de sus bases y el hash de cada
// informe— para que otra persona pueda comprobar que lo que se promociona es lo
// que se escaneó, y no una reconstrucción parecida.
//
// Uso:
//   node scripts/image-evidence.mjs --dir=image-evidence --out=image-evidence/image-evidence.json \
//     --image=uvh-api:release-e2e --dockerfile=docker/php/Dockerfile.production \
//     --image=uvh-web:release-e2e --dockerfile=docker/nginx/Dockerfile.production

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);

function valuesOf(flag) {
  return args.filter((entry) => entry.startsWith(`--${flag}=`)).map((entry) => entry.slice(flag.length + 3));
}

function valueOf(flag, fallback) {
  const found = args.find((entry) => entry.startsWith(`--${flag}=`));
  return found === undefined ? fallback : found.slice(flag.length + 3);
}

const directory = valueOf("dir", "image-evidence");
const out = valueOf("out", path.join(directory, "image-evidence.json"));
const images = valuesOf("image");
const dockerfiles = valuesOf("dockerfile");

if (images.length === 0) {
  throw new Error("Use --image=<referencia> [--image=...] [--dockerfile=<ruta>] [--dir=image-evidence] [--out=<ruta>]");
}

/**
 * Bases fijadas del Dockerfile que produjo la imagen. Se leen del fichero y no
 * de un parámetro: lo que hay que atar al artefacto es lo que el repositorio
 * declara, y así una base cambiada aparece en el expediente.
 */
function bases(dockerfile) {
  if (dockerfile === "" || !existsSync(path.join(repositoryRoot, dockerfile))) {
    return [];
  }

  return readFileSync(path.join(repositoryRoot, dockerfile), "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => /^\s*FROM\s+(.+?)\s*$/i.exec(line))
    .filter(Boolean)
    .map((match) => match[1].split(/\s+AS\s+/i)[0].trim())
    .filter((reference) => !reference.startsWith("$"));
}

function inspect(image) {
  try {
    return JSON.parse(execFileSync("docker", ["image", "inspect", image, "--format", "{{json .}}"], { encoding: "utf8" }));
  } catch (error) {
    return { error: `${error?.message ?? error}`.slice(0, 300) };
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function summaryArtifacts(image) {
  // Los informes llevan el nombre de la imagen sin la etiqueta: `uvh-api` para
  // `uvh-api:release-e2e`. Lo que no se llame así se lista igualmente, para que
  // un informe que no encaje con la convención se vea en vez de perderse.
  const slug = image.split(":")[0];
  const files = existsSync(path.join(repositoryRoot, directory))
    ? readdirSync(path.join(repositoryRoot, directory)).sort()
    : [];

  const artifacts = files.filter((file) => file.includes(slug)).map((file) => {
    const absolute = path.join(repositoryRoot, directory, file);

    return {
      file,
      bytes: readFileSync(absolute).length,
      sha256: sha256(absolute),
      kind: file.endsWith(".cdx.json") ? "sbom-cyclonedx" : file.endsWith(".sarif") ? "scan-sarif" : "other",
    };
  });

  const sbom = artifacts.find((artifact) => artifact.kind === "sbom-cyclonedx");
  const scan = artifacts.find((artifact) => artifact.kind === "scan-sarif");

  const result = { artifacts };

  if (sbom !== undefined) {
    const document = JSON.parse(readFileSync(path.join(repositoryRoot, directory, sbom.file), "utf8"));
    result.sbom = { file: sbom.file, specVersion: document.specVersion ?? "", components: (document.components ?? []).length };
  }

  if (scan !== undefined) {
    const document = JSON.parse(readFileSync(path.join(repositoryRoot, directory, scan.file), "utf8"));
    const results = (document.runs ?? []).flatMap((run) => run.results ?? []);
    const byLevel = {};
    const bySeverity = {};

    for (const finding of results) {
      const level = finding.level ?? "unknown";
      byLevel[level] = (byLevel[level] ?? 0) + 1;

      // El SARIF de Trivy mapea HIGH y CRITICAL al mismo `level: error` y deja
      // la etiqueta real dentro del texto del mensaje. Se cuenta por etiqueta
      // —que es lo que un aprobador lee— y se conserva el nivel como respaldo,
      // para que un cambio de formato se vea en vez de esconderse.
      const severity = /Severity: (CRITICAL|HIGH|MEDIUM|LOW|UNKNOWN)/.exec(finding.message?.text ?? "")?.[1] ?? level;
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }

    result.scan = { file: scan.file, findings: results.length, bySeverity, byLevel };
  }

  return result;
}

const evidence = {
  schema: "uvh-image-evidence/1",
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? process.env.COMMIT ?? null,
  images: images.map((image, index) => {
    const details = inspect(image);

    return {
      image,
      id: details.Id ?? null,
      sizeBytes: details.Size ?? null,
      created: details.Created ?? null,
      repoDigests: details.RepoDigests ?? [],
      dockerfile: dockerfiles[index] ?? "",
      bases: bases(dockerfiles[index] ?? ""),
      ...summaryArtifacts(image),
    };
  }),
};

writeFileSync(path.join(repositoryRoot, out), `${JSON.stringify(evidence, null, 2)}\n`);

process.stdout.write(`Expediente escrito en ${out}\n`);

for (const image of evidence.images) {
  const parts = [
    image.image,
    image.id ?? "(sin id)",
    `${image.bases.length} bases fijadas`,
    image.sbom === undefined ? "sin SBOM" : `SBOM ${image.sbom.components} componentes`,
    image.scan === undefined ? "sin escaneo" : `escaneo ${image.scan.findings} hallazgos ${JSON.stringify(image.scan.bySeverity)}`,
  ];

  process.stdout.write(`  ${parts.join(' | ')}\n`);
}
