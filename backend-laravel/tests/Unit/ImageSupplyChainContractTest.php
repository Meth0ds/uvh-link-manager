<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * Contract between the deployment artifacts and the supply chain around them.
 *
 * Pin an image by tag alone and the artifact that reaches production is
 * whatever that tag means the day it is pulled, which is not the artifact that
 * was reviewed. A digest pin fixes that, but it introduces two ways to lose the
 * guarantee again without any visible symptom: a new Dockerfile or compose
 * service that nobody pinned, and the same image left pinned to two different
 * digests in two files, so that which base actually runs depends on which
 * service started first.
 *
 * Nothing is downloaded here and no image is built: this is the part of the
 * policy that can be checked from the repository alone. Whether a pinned digest
 * still resolves, and whether the tag has moved on, needs a registry and has its
 * own gate — `scripts/check-image-digests.mjs`, run by the `digest-integrity`
 * job.
 */
class ImageSupplyChainContractTest extends TestCase
{
    private const CI_WORKFLOW = '.github/workflows/ci.yml';

    private const DEPENDABOT = '.github/dependabot.yml';

    private const DIGEST_SCRIPT = 'scripts/check-image-digests.mjs';

    private const RELEASE_EVIDENCE = 'docs/release-evidence-template.md';

    private const PROVENANCE_RUNBOOK = 'docs/image-provenance-runbook.md';

    /**
     * Directories that hold no reviewable artifact. `storage` also carries a
     * PHPStan cache and `vendor`/`node_modules` are installed dependencies:
     * walking them would only make this test slow.
     */
    private const UNWALKABLE = ['vendor', 'node_modules', '.git', '.angular', '.uvh-runtime', 'storage'];

    /**
     * Images this repository builds itself. They are named `uvh-*` on purpose:
     * a locally built image has no digest to pin, so the naming is what tells
     * the two kinds apart, and a rule with an exception has to state it.
     */
    private const LOCAL_IMAGE_PREFIX = 'uvh-';

    private const DIGEST = '/^sha256:[0-9a-f]{64}$/';

    /**
     * Relative paths of every regular file whose name matches the pattern,
     * reported sorted so a failure reads the same twice.
     *
     * @return list<string>
     */
    private function filesMatching(string $pattern, ?string $directory = null): array
    {
        $root = RepositoryRoot::path();
        $matches = [];
        $pending = [$directory === null ? $root : $root.'/'.$directory];

        while ($pending !== []) {
            $current = array_pop($pending);
            $entries = scandir($current);

            foreach ($entries === false ? [] : $entries as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }

                $path = $current.'/'.$entry;

                if (is_dir($path)) {
                    if (! in_array($entry, self::UNWALKABLE, true)) {
                        $pending[] = $path;
                    }

                    continue;
                }

                if (preg_match($pattern, $entry) === 1) {
                    $matches[] = str_replace('\\', '/', substr($path, strlen($root) + 1));
                }
            }
        }

        sort($matches);

        return $matches;
    }

    /**
     * Dockerfiles of the repository, including the development and drill copies
     * that never reach production: a dev image that resolves to a moving base is
     * still a build nobody can reproduce.
     *
     * @return list<string>
     */
    private function dockerfiles(): array
    {
        return $this->filesMatching('/dockerfile/i');
    }

    /**
     * Compose files at the repository root. Dependabot reads any YAML file whose
     * name does not start with a dot, so these are also the files it maintains.
     *
     * @return list<string>
     */
    private function composeFiles(): array
    {
        return $this->filesMatching('/^docker-compose.*\.ya?ml$/');
    }

    /**
     * Every base image a Dockerfile pulls, as `['file' => ..., 'line' => ...,
     * 'reference' => ...]`, covering both `FROM` and `COPY --from=`, and telling
     * a build-stage name apart from an image.
     *
     * @return list<array{file: string, line: int, reference: string}>
     */
    private function dockerfileReferences(string $file): array
    {
        $lines = explode("\n", RepositoryRoot::read($file));

        $stages = [];
        foreach ($lines as $line) {
            if (preg_match('/^\s*FROM\s+\S+(?:\s+--\S+)*\s+AS\s+(\S+)\s*$/i', $line, $alias) === 1) {
                $stages[] = strtolower($alias[1]);
            }
        }

        $references = [];

        foreach ($lines as $offset => $line) {
            if (preg_match('/^\s*FROM\s+(.+?)\s*$/i', $line, $from) === 1) {
                $token = preg_split('/\s+AS\s+/i', trim($from[1]))[0];
                // `--platform=$TARGETPLATFORM` and friends precede the image.
                $token = preg_replace('/^(?:--\S+\s+)+/', '', trim($token));

                $references[] = ['file' => $file, 'line' => $offset + 1, 'reference' => $token];

                continue;
            }

            if (preg_match('/--from=(\S+)/', $line, $copy) === 1) {
                $token = $copy[1];

                if (! in_array(strtolower($token), $stages, true)) {
                    $references[] = ['file' => $file, 'line' => $offset + 1, 'reference' => $token];
                }
            }
        }

        return $references;
    }

    /**
     * Every remote `image:` a compose file starts, as `['file' => ..., 'line' =>
     * ..., 'reference' => ...]`. Locally built images (`uvh-*`) are returned too,
     * so the caller can require that a `build:` exists in the same file.
     *
     * @return list<array{file: string, line: int, reference: string}>
     */
    private function composeReferences(string $file): array
    {
        $references = [];

        foreach (explode("\n", RepositoryRoot::read($file)) as $offset => $line) {
            if (preg_match('/^\s*image:\s*(\S+)\s*$/', $line, $image) !== 1) {
                continue;
            }

            $references[] = ['file' => $file, 'line' => $offset + 1, 'reference' => $image[1]];
        }

        return $references;
    }

    /**
     * Splits `name[:tag][@sha256:...]` into its parts, or fails naming the file
     * and line. A reference that cannot be split is a reference nobody can
     * audit, so it is a failure rather than a skip.
     *
     * @return array{name: string, tag: ?string, digest: ?string}
     */
    private function split(array $entry): array
    {
        $reference = $entry['reference'];

        $this->assertStringNotContainsString(
            '$',
            $reference,
            "{$entry['file']}:{$entry['line']} builds or starts an image from a variable: '{$reference}' cannot be pinned or audited",
        );

        $this->assertMatchesRegularExpression(
            '#^(?<name>[a-zA-Z0-9][a-zA-Z0-9._:/-]*?)(?::(?<tag>[a-zA-Z0-9][a-zA-Z0-9._-]*))?(?:@(?<digest>sha256:[0-9a-f]{64}))?$#',
            $reference,
            "{$entry['file']}:{$entry['line']} is not an image reference: '{$reference}'",
        );

        preg_match(
            '#^(?<name>[a-zA-Z0-9][a-zA-Z0-9._:/-]*?)(?::(?<tag>[a-zA-Z0-9][a-zA-Z0-9._-]*))?(?:@(?<digest>sha256:[0-9a-f]{64}))?$#',
            $reference,
            $parts,
        );

        return [
            'name' => $parts['name'],
            'tag' => ($parts['tag'] ?? '') === '' ? null : $parts['tag'],
            'digest' => ($parts['digest'] ?? '') === '' ? null : $parts['digest'],
        ];
    }

    public function test_every_dockerfile_builds_from_a_pinned_base_image(): void
    {
        $dockerfiles = $this->dockerfiles();

        $this->assertGreaterThanOrEqual(
            6,
            count($dockerfiles),
            'the six Dockerfiles are the artifacts under this contract; losing one means this test stopped covering it',
        );

        $seen = 0;

        foreach ($dockerfiles as $file) {
            foreach ($this->dockerfileReferences($file) as $entry) {
                $parts = $this->split($entry);
                $seen++;

                $this->assertNotNull(
                    $parts['tag'],
                    "{$file}:{$entry['line']} pulls '{$entry['reference']}' without a tag: pinning a digest keeps the tag readable, but nobody can tell which release it was",
                );

                $this->assertNotNull(
                    $parts['digest'],
                    "{$file}:{$entry['line']} pulls '{$entry['reference']}' by tag alone: the base image would be whatever that tag means on the day of the build",
                );
            }
        }

        // Nine remote bases today: dos en el Dockerfile de desarrollo (composer
        // y php), dos en el de producción, y una en cada uno de los otros cuatro.
        // El `COPY --from=composer` del desarrollo no cuenta: apunta a una etapa
        // con nombre, y su digest es el de la línea `FROM` que la declara.
        $this->assertGreaterThanOrEqual(9, $seen, 'every Dockerfile stage has to be examined, not just the first one');
    }

    public function test_every_compose_image_is_pinned_or_built_here(): void
    {
        $files = $this->composeFiles();
        $this->assertGreaterThanOrEqual(9, count($files), 'the nine compose files are the topologies under this contract');

        $pinned = 0;

        foreach ($files as $file) {
            $contents = RepositoryRoot::read($file);

            foreach ($this->composeReferences($file) as $entry) {
                $parts = $this->split($entry);

                if (str_starts_with($parts['name'], self::LOCAL_IMAGE_PREFIX)) {
                    $this->assertStringContainsString(
                        'build:',
                        $contents,
                        "{$file} starts '{$entry['reference']}', which this repository does not pull: it has to be built there, and '{$file}' declares no build",
                    );

                    continue;
                }

                $pinned++;

                $this->assertNotNull(
                    $parts['digest'],
                    "{$file}:{$entry['line']} starts '{$entry['reference']}' by tag alone: the container would be whatever that tag means at the next `up`",
                );
            }
        }

        $this->assertGreaterThanOrEqual(14, $pinned, 'the remote images of the compose files have to be examined, not just the first one');
    }

    public function test_the_same_image_is_pinned_to_the_same_digest_everywhere(): void
    {
        $byReference = [];

        foreach ($this->dockerfiles() as $file) {
            foreach ($this->dockerfileReferences($file) as $entry) {
                $parts = $this->split($entry);

                if ($parts['digest'] === null) {
                    continue;
                }

                $key = $parts['name'].':'.$parts['tag'];
                $byReference[$key][$parts['digest']][] = "{$file}:{$entry['line']}";
            }
        }

        foreach ($this->composeFiles() as $file) {
            foreach ($this->composeReferences($file) as $entry) {
                $parts = $this->split($entry);

                if ($parts['digest'] === null || str_starts_with($parts['name'], self::LOCAL_IMAGE_PREFIX)) {
                    continue;
                }

                $key = $parts['name'].':'.$parts['tag'];
                $byReference[$key][$parts['digest']][] = "{$file}:{$entry['line']}";
            }
        }

        $this->assertNotSame([], $byReference, 'no image is pinned at all, which means the pinning was reverted');

        foreach ($byReference as $reference => $digests) {
            $this->assertCount(
                1,
                $digests,
                $reference.' resolves to '.count($digests).' different digests, so which base image runs depends on the file: '
                .implode(' vs ', array_map(
                    static fn (array $sites): string => $sites[0].' ('.implode(', ', $sites).')',
                    $digests,
                )),
            );
        }
    }

    /**
     * Declaring `ENTRYPOINT` in a child image resets the `CMD` inherited from the
     * base to an empty value, and an image with no command starts, finishes its
     * entrypoint and exits 0 in milliseconds. Nothing in this repository called
     * that a failure: Compose reports a short-lived container as `exited`, not as
     * an error, and the image gate only looks at packages. The web image spent
     * its life like that until a base swap was verified by actually starting it.
     */
    public function test_every_dockerfile_that_declares_an_entrypoint_declares_a_command(): void
    {
        // The one entrypoint that ignores its arguments on purpose and is meant to
        // finish: it generates the self-signed certificates of the boot contract
        // and exits, which is the whole job.
        $runsWithoutArguments = ['docker/release-boot/certs/Dockerfile'];

        $seen = 0;

        foreach ($this->dockerfiles() as $file) {
            $lines = explode("\n", RepositoryRoot::read($file));

            $entrypoint = array_filter(
                $lines,
                static fn (string $line): bool => preg_match('/^\s*ENTRYPOINT\s/i', $line) === 1,
            );

            if ($entrypoint === []) {
                continue;
            }

            $seen++;

            if (in_array($file, $runsWithoutArguments, true)) {
                continue;
            }

            $command = array_filter(
                $lines,
                static fn (string $line): bool => preg_match('/^\s*CMD\s/i', $line) === 1,
            );

            $this->assertNotSame(
                [],
                $command,
                "{$file} declares ENTRYPOINT without CMD: the command inherited from the base image is reset to empty, so the container exits 0 without running anything",
            );
        }

        $this->assertGreaterThanOrEqual(
            3,
            $seen,
            'the Dockerfiles that declare an entrypoint are exactly the ones this rule covers; finding fewer means the rule stopped looking',
        );
    }

    public function test_dependabot_maintains_every_directory_that_holds_a_dockerfile(): void
    {
        $config = RepositoryRoot::read(self::DEPENDABOT);

        preg_match_all(
            '/- package-ecosystem: docker\n\s+directory: (\S+)/',
            $config,
            $directories,
        );

        $declared = $directories[1];
        $this->assertNotSame([], $declared, 'without a docker ecosystem entry a pinned digest never gets an update proposal');

        // Every directory that holds a Dockerfile has to be maintained, derived
        // from disk rather than listed: a new Dockerfile in a new directory would
        // otherwise be pinned once and then silently freeze.
        $expected = ['/'];

        foreach ($this->dockerfiles() as $file) {
            $expected[] = '/'.dirname($file);
        }

        $expected = array_values(array_unique($expected));
        sort($expected);
        sort($declared);

        $this->assertSame(
            $expected,
            $declared,
            'the docker ecosystem entries drifted from the directories that hold a Dockerfile, or from the root that holds the compose files',
        );

        // The same reasoning as the other ecosystems: a compromised release is
        // normally withdrawn within days. One `default-days` per ecosystem
        // entry means neither the docker entries nor the older ones can lose it.
        $this->assertSame(
            substr_count($config, '- package-ecosystem: '),
            substr_count($config, 'default-days: 7'),
            'every ecosystem needs the cooldown, otherwise the docker entry becomes the fast path',
        );
    }

    public function test_the_digest_integrity_gate_resolves_every_pin_in_ci(): void
    {
        $script = RepositoryRoot::read(self::DIGEST_SCRIPT);
        $workflow = RepositoryRoot::read(self::CI_WORKFLOW);

        // What the script has to do, stated as the three outcomes it can report:
        // a pin that resolves, a tag that moved on, and a pin that no longer
        // resolves. The last one fails: a dangling digest stops a build, and
        // finding out in the deployment is too late.
        foreach (['ok', 'drift', 'unresolved'] as $status) {
            $this->assertStringContainsString($status, $script, "the digest report no longer distinguishes '{$status}'");
        }

        // Reported by status and non-zero exit only for a real defect: a pin that
        // no longer resolves blocks, and the other two outcomes are printed.
        $this->assertStringContainsString('process.exit(1)', $script);
        $this->assertStringContainsString('docker-compose', $script);
        $this->assertStringContainsString('Dockerfile', $script);

        $this->assertStringContainsString('digest-integrity:', $workflow, 'the gate has to be a job of the CI workflow, not a local habit');
        $this->assertStringContainsString('node scripts/check-image-digests.mjs', $workflow);
    }

    public function test_the_production_images_get_an_sbom_and_a_scan_where_they_are_built(): void
    {
        $workflow = RepositoryRoot::read(self::CI_WORKFLOW);

        // Both production images are built by the release smoke job. Scanning
        // them anywhere else would scan a reconstruction, not the artifact.
        $this->assertStringContainsString('uvh-api:release-e2e', $workflow);
        $this->assertStringContainsString('uvh-web:release-e2e', $workflow);
        $this->assertStringContainsString('--format cyclonedx', $workflow, 'the SBOM has to be CycloneDX, which is what a consumer can read');
        // El nombre del SBOM sale del nombre de la imagen sin su etiqueta, para
        // que el expediente sepa qué informe corresponde a qué artefacto.
        $this->assertStringContainsString('sbom-${image%%:*}.cdx.json', $workflow);
        $this->assertStringContainsString('vuln-${image%%:*}.sarif', $workflow);
        // El analizador entra por variable de entorno, para que la versión esté en
        // un solo sitio del trabajo.
        $this->assertStringContainsString('"$TRIVY_IMAGE" image', $workflow);
        $this->assertStringContainsString('--severity HIGH,CRITICAL', $workflow);
        $this->assertStringContainsString('image-evidence.json', $workflow, 'the gate has to leave the digest it scanned behind');

        // The gate itself: a CRITICAL that already has a published fix stops the
        // job, and the published report is generated without the ignore file so
        // that what an exception hides is still in the report. `--ignore-unfixed`
        // keeps the gate passable: gating on a fix that does not exist turns it
        // into a list of exceptions, which is worse than not having one.
        preg_match('/- name: Gate on CRITICAL vulnerabilities[^\n]*\n(?:\s+.*\n)*?\s+"\$image"\n/', $workflow, $gate);
        $this->assertNotSame([], $gate, 'the CRITICAL gate has to exist as its own step of the release smoke job');

        foreach (['--severity CRITICAL', '--ignore-unfixed', '--ignorefile /repo/.trivyignore.yaml', '--exit-code 1'] as $flag) {
            $this->assertStringContainsString($flag, $gate[0], "the image gate dropped {$flag}");
        }

        // A report that cannot fail is the document; the gate is the decision.
        // Generating the report with the ignore file would hide the accepted
        // finding from the artifact that is supposed to record it.
        preg_match('/- name: Publish the full HIGH and CRITICAL report[^\n]*\n(?:\s+.*\n)*?\s+"\$image"\n/', $workflow, $report);
        $this->assertNotSame([], $report, 'the full report has to exist as its own step');
        $this->assertStringNotContainsString('--ignorefile', $report[0], 'the report must include what the gate suppresses, or nobody can review the exception');
        $this->assertStringNotContainsString('--exit-code', $report[0], 'a report that blocks is a gate with a different name: two steps, two jobs');

        // The evidence is what a failing gate is judged on, so it has to be
        // uploaded regardless of the outcome.
        preg_match('/- name: Preserve the image evidence[^\n]*\n(?:\s+.*\n)*?\s+name: image-evidence-/', $workflow, $upload);
        $this->assertNotSame([], $upload, 'the image evidence has to be uploaded as its own artifact');
        $this->assertMatchesRegularExpression('/if: always\(\)/', $upload[0]);
    }

    public function test_the_evidence_template_and_the_runbook_ask_for_the_artifact_not_the_recipe(): void
    {
        $evidence = RepositoryRoot::read(self::RELEASE_EVIDENCE);
        $runbook = RepositoryRoot::read(self::PROVENANCE_RUNBOOK);

        foreach (['Digest `uvh-api`', 'Digest `uvh-web`'] as $field) {
            $this->assertStringContainsString($field, $evidence, "the evidence template no longer asks for {$field}, which is what makes a candidate immutable");
        }

        foreach (['SBOM', 'Trivy'] as $artifact) {
            $this->assertStringContainsString($artifact, $evidence, "the evidence template no longer asks for the {$artifact} of the images it promotes");
        }

        // The runbook exists to state the rule that makes the digest useful: the
        // server never builds. What could not be executed is named as such
        // rather than left as an instruction nobody followed.
        $this->assertStringContainsString('docker build', $runbook);
        $this->assertStringContainsString('no ejecutado', $runbook, 'the runbook has to say which steps were never executed, and why');
        $this->assertStringContainsString('cosign', $runbook, 'signing is the remaining rung of the chain and has to be described');
    }
}
