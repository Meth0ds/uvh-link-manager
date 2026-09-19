<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Contract between the security scans and the files that configure them.
 *
 * Semgrep, Gitleaks and Trivy only gate a change while three things stay true at
 * the same time: the default detections remain enabled, every exception stays
 * narrow enough to be reviewed, and the workflow keeps the thresholds the
 * documentation promises. None of that is enforced by the tools themselves. An
 * allowlist path that grows from a fixture directory to the application's own
 * source disables the gate silently, and a `--severity` that drifts from ERROR
 * to INFO turns a gate into a log line.
 *
 * No scanner runs here and nothing is downloaded: this is the part of the policy
 * that can be checked from the repository alone.
 */
class SecurityScanContractTest extends TestCase
{
    private const GITLEAKS_POLICY = '.gitleaks.toml';

    private const GITLEAKS_FINGERPRINTS = '.gitleaksignore';

    private const TRIVY_IGNORES = '.trivyignore.yaml';

    private const SECURITY_WORKFLOW = '.github/workflows/security.yml';

    private const CODEQL_WORKFLOW = '.github/workflows/codeql.yml';

    private const CI_WORKFLOW = '.github/workflows/ci.yml';

    private const STATIC_ANALYSIS_DOC = 'docs/static-analysis.md';

    /**
     * Directories that make a whole-repository walk unusable: installed
     * dependencies, the PHPStan cache under `storage/`, and the directory the
     * local scanner runs write to.
     */
    private const UNWALKABLE = ['vendor', 'node_modules', '.git', '.angular', '.uvh-runtime', 'storage'];

    /**
     * Source that must keep being scanned. An exception covering any of these
     * would mean a real credential pasted there is never reported.
     */
    private const SCANNED_SOURCE = [
        'backend-laravel/app/',
        'backend-laravel/config/',
        'backend-laravel/database/',
        'backend-laravel/routes/',
        'frontend/src/',
        '.github/workflows/',
    ];

    /**
     * Semgrep rulesets the workflow and the documentation promise. A run that
     * silently drops one still reports "no findings".
     */
    private const SEMGREP_RULESETS = [
        'p/php',
        'p/security-audit',
        'p/owasp-top-ten',
        'p/php-laravel',
        'p/sql-injection',
        'p/xss',
        'p/jwt',
        'p/insecure-transport',
        'p/command-injection',
    ];

    private function repositoryRoot(): string
    {
        return dirname(__DIR__, 3);
    }

    /**
     * A whole-file read with normalized line endings, or a failure that names
     * the missing file. A contract test that silently checks an empty string is
     * worse than no test.
     *
     * The scanned files live outside `backend-laravel/`, so this needs the
     * repository root. CI checks out the whole repository and runs the suite from
     * `backend-laravel/`, which is the layout this expects; a run against a copy
     * of `backend-laravel/` alone cannot check it and is reported as such.
     */
    private function read(string $relative): string
    {
        $path = $this->repositoryRoot().'/'.$relative;
        $this->assertFileExists(
            $path,
            "{$relative} is part of the security gate and must exist; running the suite without the repository root cannot check it.",
        );

        $contents = file_get_contents($path);
        $this->assertIsString($contents, "{$relative} could not be read");
        $this->assertNotSame('', trim($contents), "{$relative} is empty");

        return str_replace("\r\n", "\n", $contents);
    }

    /**
     * Every `[[allowlists]]` block of the Gitleaks policy.
     *
     * @return list<array{description: string, paths: list<string>}>
     */
    private function gitleaksAllowlists(string $policy): array
    {
        $allowlists = [];

        foreach (array_slice(explode('[[allowlists]]', $policy), 1) as $block) {
            preg_match('/description = "([^"]*)"/', $block, $description);
            preg_match('/paths = \[(.*?)\]/s', $block, $paths);
            preg_match_all("/'''([^']+)'''/", $paths[1] ?? '', $quoted);

            $allowlists[] = [
                'description' => $description[1] ?? '',
                'paths' => array_values($quoted[1]),
            ];
        }

        return $allowlists;
    }

    /**
     * Every entry of the Trivy ignore file, in file order and tagged with the
     * section it belongs to.
     *
     * The two sections are validated with different rules, so the section has to
     * survive parsing: a `paths` list only means something for a finding about a
     * repository file, and an expiry only means something for a vulnerability
     * inside an image.
     *
     * @return list<array{section: string, id: string, paths: list<string>, statement: string, expired_at: string}>
     */
    private function trivySuppressions(string $ignoreFile): array
    {
        $suppressions = [];
        $section = '';

        foreach (explode("\n", $ignoreFile) as $line) {
            if (preg_match('/^([a-z]+):\s*$/', $line, $header) === 1) {
                $section = $header[1];

                continue;
            }

            if (preg_match('/^\s+- id: (\S+)\s*$/', $line, $id) === 1) {
                $suppressions[] = ['section' => $section, 'id' => $id[1], 'paths' => [], 'statement' => '', 'expired_at' => ''];

                continue;
            }

            if ($suppressions === []) {
                continue;
            }

            $index = count($suppressions) - 1;

            if (preg_match('/^\s+- "([^"]+)"\s*$/', $line, $path) === 1) {
                $suppressions[$index]['paths'][] = $path[1];
            }

            if (preg_match('/^\s+statement: "([^"]*)"\s*$/', $line, $statement) === 1) {
                $suppressions[$index]['statement'] = $statement[1];
            }

            if (preg_match('/^\s+expired_at: (\S+)\s*$/', $line, $expiry) === 1) {
                $suppressions[$index]['expired_at'] = $expiry[1];
            }
        }

        return $suppressions;
    }

    /**
     * The entries of one section only.
     *
     * @return list<array{section: string, id: string, paths: list<string>, statement: string, expired_at: string}>
     */
    private function trivySuppressionsIn(string $section): array
    {
        return array_values(array_filter(
            $this->trivySuppressions($this->read(self::TRIVY_IGNORES)),
            static fn (array $suppression): bool => $suppression['section'] === $section,
        ));
    }

    /**
     * Relative paths of the files that mention a literal, walking the repository
     * but skipping the directories that hold no reviewable source.
     *
     * @return list<string>
     */
    private function filesMentioning(string $needle): array
    {
        $root = $this->repositoryRoot();
        $matches = [];
        $pending = [$root];

        while ($pending !== []) {
            $directory = array_pop($pending);
            $entries = scandir($directory);

            foreach ($entries === false ? [] : $entries as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }

                $path = $directory.'/'.$entry;

                if (is_dir($path)) {
                    if (! in_array($entry, self::UNWALKABLE, true)) {
                        $pending[] = $path;
                    }

                    continue;
                }

                $contents = is_file($path) ? file_get_contents($path) : false;

                if (is_string($contents) && str_contains($contents, $needle)) {
                    $matches[] = str_replace('\\', '/', substr($path, strlen($root) + 1));
                }
            }
        }

        sort($matches);

        return $matches;
    }

    public function test_gitleaks_keeps_the_default_rules_and_only_excepts_synthetic_values(): void
    {
        $policy = $this->read(self::GITLEAKS_POLICY);

        $this->assertMatchesRegularExpression(
            '/\[extend\]\nuseDefault = true/',
            $policy,
            'Turning the default rule set off would disable the tool rather than tune it.',
        );

        $allowlists = $this->gitleaksAllowlists($policy);
        $this->assertGreaterThanOrEqual(4, count($allowlists), 'the four documented exceptions must stay declared');

        $declared = [];

        foreach ($allowlists as $allowlist) {
            $this->assertGreaterThan(
                20,
                strlen($allowlist['description']),
                "every allowlist needs a reason long enough to review, got '{$allowlist['description']}'",
            );
            $this->assertNotSame([], $allowlist['paths'], 'an allowlist without paths would suppress every finding');

            foreach ($allowlist['paths'] as $path) {
                $declared[] = $path;

                foreach (self::SCANNED_SOURCE as $source) {
                    $this->assertStringNotContainsString(
                        $source,
                        $path,
                        "the exception '{$path}' covers {$source}: a credential committed there would stop being reported.",
                    );
                }
            }
        }

        // The exceptions that do exist are the fixture locations, named here so
        // that widening or narrowing them is a visible change in review.
        foreach ([
            'backend-laravel/tests/',
            'frontend/e2e/',
            'docker/release-boot/production.env',
            '\.gitleaksignore$',
        ] as $expected) {
            $this->assertContains($expected, $declared, "the policy no longer declares the exception for {$expected}");
        }
    }

    public function test_every_historical_fingerprint_is_a_reviewed_finding_with_its_reason(): void
    {
        $contents = $this->read(self::GITLEAKS_FINGERPRINTS);

        $fingerprints = 0;
        $commented = 0;

        foreach (explode("\n", $contents) as $offset => $line) {
            $line = trim($line);

            if ($line === '') {
                continue;
            }

            if (str_starts_with($line, '#')) {
                $commented++;

                continue;
            }

            $fingerprints++;

            // `commit:path:rule:line`, pinned to the commit so the same pattern
            // arriving in a new revision is reported again.
            $this->assertMatchesRegularExpression(
                '/^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/',
                $line,
                'line '.($offset + 1)." is not a fingerprint: '{$line}'",
            );
        }

        $this->assertGreaterThan(0, $fingerprints, 'an empty ignore file would hide the historical scan, not fix it');
        $this->assertGreaterThanOrEqual(
            $fingerprints,
            $commented,
            'each fingerprint needs a written reason: they are findings a human reviewed, not a blanket exception',
        );
    }

    public function test_trivy_misconfiguration_suppressions_are_scoped_to_real_files_and_state_why(): void
    {
        $suppressions = $this->trivySuppressionsIn('misconfigurations');

        $this->assertNotSame([], $suppressions, 'the ignore file must declare its entries as data, not as prose');

        // Every id here is a finding the HIGH/CRITICAL gate would otherwise stop
        // on. A new id is a new decision: it has to be added deliberately.
        $documented = ['DS-0002', 'AVD-DS-0002'];

        foreach ($suppressions as $suppression) {
            $this->assertContains(
                $suppression['id'],
                $documented,
                "suppressing {$suppression['id']} is a new decision: declare it here with the severity that justifies it",
            );
            $this->assertGreaterThan(
                30,
                strlen($suppression['statement']),
                "suppression {$suppression['id']} needs a statement explaining why the finding is structural",
            );
            $this->assertNotSame([], $suppression['paths'], "suppression {$suppression['id']} must name the files it covers");
            $this->assertSame(
                '',
                $suppression['expired_at'],
                "suppression {$suppression['id']} covers a repository file: that is fixed or deleted, not given a date",
            );

            foreach ($suppression['paths'] as $path) {
                $this->assertStringEndsNotWith(
                    '/',
                    $path,
                    "suppression {$suppression['id']} covers the directory {$path}: a file added inside would inherit it",
                );
                $this->assertFileExists(
                    $this->repositoryRoot().'/'.$path,
                    "suppression {$suppression['id']} names {$path}, which no longer exists: an exception that outlives its file hides the next one",
                );
            }
        }
    }

    public function test_trivy_vulnerability_suppressions_expire_and_state_why(): void
    {
        $suppressions = $this->trivySuppressionsIn('vulnerabilities');

        // Every id here is a CRITICAL with a published fix that a scanned image
        // gate would otherwise stop on. Accepting one is a decision with a date,
        // and the tool enforces the date: after `expired_at`, Trivy reports the
        // finding again, so the exception cannot survive unnoticed.
        //
        // Two of the three findings of the first widened run are here because a
        // new pin does not close them —one is inside the `gosu` binary of the
        // PostgreSQL image, the other inside the `tar` npm ships with Node—, and
        // the third (`postgres:16` of Debian, three CRITICALs in the Perl
        // packages) was closed by moving that image to the Alpine base instead.
        // Any id that is not on this list is a new decision and fails here until
        // it is written down.
        $documented = ['CVE-2025-68121', 'CVE-2026-59873'];

        foreach ($suppressions as $suppression) {
            $this->assertContains(
                $suppression['id'],
                $documented,
                "accepting {$suppression['id']} is a new risk decision: declare it here with the measurement that justifies it",
            );
            $this->assertMatchesRegularExpression(
                '/^CVE-\d{4}-\d{4,}$/',
                $suppression['id'],
                "a vulnerability entry must name a CVE, got '{$suppression['id']}'",
            );
            $this->assertGreaterThan(
                30,
                strlen($suppression['statement']),
                "accepted {$suppression['id']} needs a statement naming how it gets closed",
            );
            $this->assertMatchesRegularExpression(
                '/^\d{4}-\d{2}-\d{2}$/',
                $suppression['expired_at'],
                "accepted {$suppression['id']} needs an `expired_at`: an accepted vulnerability without a date is a permanent exception",
            );
            $this->assertGreaterThan(
                strtotime('today'),
                strtotime($suppression['expired_at']),
                "the acceptance of {$suppression['id']} has expired: renew it deliberately or close the finding",
            );

            // A path inside an image cannot be checked from the repository —the
            // file is not here—, so what is checked is the shape of the scope:
            // one concrete file and no pattern. A wildcard here would widen
            // silently, and the scan proves in every run that the path still
            // matches a finding instead of passing unnoticed.
            foreach ($suppression['paths'] as $path) {
                $this->assertStringNotContainsString(
                    '*',
                    $path,
                    "{$suppression['id']} scopes itself with the pattern '{$path}': a pattern suppresses whatever it matches tomorrow, not what was reviewed today",
                );
                $this->assertStringEndsNotWith(
                    '/',
                    $path,
                    "{$suppression['id']} scopes a directory ('{$path}'): any finding inside it would be covered",
                );
                $this->assertStringContainsString(
                    '/',
                    $path,
                    "{$suppression['id']} scopes '{$path}', which is not a path inside an image",
                );
            }

            // Scoping by path only means something while a job scans those
            // images and reports what each entry suppressed: without it, an
            // entry that already covers nothing reads as approved.
            $this->assertStringContainsString(
                'scan-pinned-images.mjs',
                $this->read(self::CI_WORKFLOW),
                'a path-scoped acceptance is only verifiable while the base image gate runs in CI',
            );
        }
    }

    /**
     * The gate that scans the bases this repository does not build.
     *
     * `release-e2e` judges the two images the repository compiles; Caddy, the
     * production edge, and PostgreSQL and Redis, which hold the drills, were
     * judged by nobody. What has to stay true is the source of the list —not a
     * copy in the script, which would fall behind without failing— and the
     * shape of the gate itself.
     */
    public function test_the_base_image_gate_scans_every_pinned_base(): void
    {
        $workflow = $this->read(self::CI_WORKFLOW);
        $script = $this->read('scripts/scan-pinned-images.mjs');

        $this->assertStringContainsString(
            'node scripts/scan-pinned-images.mjs',
            $workflow,
            'the workflow no longer scans the pinned bases: the findings behind those pins would stop blocking anything',
        );
        $this->assertStringContainsString('if: always()', $workflow);

        // The list comes from the script that walks the repository. A literal
        // list here would be a second source of truth, and the one left behind
        // does not fail: it stops looking.
        //
        // The quotes are part of what is checked: every one of these names also
        // appears in the comments of the script that explain it, so looking for
        // the bare word would keep passing after the argument itself was
        // deleted. That is not hypothetical — the first version of this test did
        // exactly that, and removing `--show-suppressed` from the command left it
        // green.
        $this->assertStringContainsString(
            '"--references"',
            $script,
            'the gate must ask for the pinned references instead of declaring its own list',
        );
        $this->assertStringContainsString('"scripts/check-image-digests.mjs"', $script);
        $this->assertStringNotContainsString(
            'sha256:',
            $script,
            'the gate names a specific image digest: the list has to be derived from the tree, not written here',
        );

        // Same bar as the images the repository builds: CRITICAL that already
        // has a fix. HIGH is published and does not block, for the same reason
        // it does not block there.
        foreach (['"--severity"', '"CRITICAL"', '"--ignore-unfixed"', '"--exit-code"', '"1"'] as $flag) {
            $this->assertStringContainsString($flag, $script, "the base gate no longer passes {$flag}");
        }

        $this->assertStringContainsString('"--ignorefile"', $script, 'without the ignore file the accepted findings would block the gate instead of being reported');
        $this->assertStringContainsString('"--show-suppressed"', $script, 'without --show-suppressed an entry that already suppresses nothing cannot be told apart from one that still does');
        $this->assertStringContainsString('"--format", "json"', $script, 'the verdict has to come from the JSON report: the table carries one total per target and no suppression count that can be trusted');
        $this->assertStringContainsString('ExperimentalModifiedFindings', $script, 'the suppressed findings are read from the JSON report, not guessed from the table');
        $this->assertStringContainsString('process.exit(1)', $script, 'the gate has to be able to fail');
        $this->assertStringContainsString('"unavailable"', $script, 'a scan that could not happen is reported as its own outcome, not as a clean image');

        // The suppression verdict is decided entry by entry. Judging the
        // section total let a dead entry hide behind a live one: measured with
        // two in-use entries and a third whose scope exists in no image, the
        // verdict was `in-use` and the gate stayed quiet — and every extra
        // exception would have made the check more blind, not less.
        $this->assertStringContainsString(
            '...staleEntries.map(',
            $script,
            'the stale verdict has to name each entry: a section total hides a dead exception behind a live one',
        );
        $this->assertStringContainsString(
            'la entrada ${entry.id} no la usó ningún escaneo',
            $script,
            'a stale entry has to be reported with its own id, the one a reviewer has to go and delete',
        );

        // Only a scan that produced a report can tell whether an entry still
        // suppresses something. With the daemon down, every image is
        // `unavailable`, no scan suppresses anything, and concluding "stale"
        // from that pressurises deleting a valid exception: the gate would fail
        // for the reason it exists to prevent.
        $this->assertStringContainsString(
            'const conclusive = results.filter((result) => result.status === "clean" || result.status === "findings");',
            $script,
            'the conclusion about an entry needs a report from the image: an unreachable daemon is not evidence of anything',
        );
        $this->assertStringContainsString(
            'uncheckedEntries',
            $script,
            'an entry no scan could check is its own outcome, not a stale one',
        );
    }

    public function test_every_inline_semgrep_suppression_names_one_rule_and_its_reason(): void
    {
        $files = $this->filesMentioning('nosemgrep');
        $this->assertNotSame([], $files, 'the two Dockerfile suppressions are part of the measured result; losing them silently reopens the finding');

        foreach ($files as $relative) {
            $lines = explode("\n", $this->read($relative));

            foreach ($lines as $offset => $line) {
                // Only a comment can suppress a finding. A file that merely
                // mentions the directive (this test, or the documentation) is
                // not a suppression and must not be asked for a reason.
                if (! str_contains($line, 'nosemgrep') || preg_match('~^\s*(?:#|//|/\*|\*)~', $line) !== 1) {
                    continue;
                }

                $this->assertMatchesRegularExpression(
                    '/nosemgrep: [a-z0-9]+(?:\.[a-z0-9_-]+)+$/',
                    trim($line),
                    "{$relative}:".($offset + 1).' must name exactly one rule: a bare nosemgrep silences every rule in the file',
                );

                // A fixed marker rather than the word "motivo" anywhere in the
                // neighbourhood: an unrelated sentence must not satisfy it.
                $context = implode("\n", array_slice($lines, max(0, $offset - 10), 10));
                $this->assertMatchesRegularExpression(
                    '/^#\s*Motivo:\s*\S/im',
                    $context,
                    "{$relative}:".($offset + 1).' needs "# Motivo: ..." written above the suppression',
                );
            }
        }
    }

    public function test_the_security_workflow_keeps_the_gates_the_documentation_promises(): void
    {
        $workflow = $this->read(self::SECURITY_WORKFLOW);

        // A new advisory on unchanged code only appears if something looks
        // again, which is what the weekly run is for.
        $this->assertMatchesRegularExpression('/^\s+schedule:\n\s+- cron: /m', $workflow);
        $this->assertStringContainsString('workflow_dispatch:', $workflow);

        // Semgrep: the measured rulesets, and a gate only on ERROR.
        foreach (self::SEMGREP_RULESETS as $ruleset) {
            $this->assertStringContainsString(
                '--config '.$ruleset,
                $workflow,
                "the workflow no longer runs {$ruleset}: a ruleset that silently disappears still reports 'no findings'",
            );
        }
        $this->assertStringContainsString('--severity ERROR', $workflow);

        // Indentation and the continuation backslash removed, so the flag is
        // compared as the argument Semgrep actually receives.
        $arguments = array_map(
            static fn (string $line): string => trim($line, " \t\\"),
            explode("\n", $workflow),
        );
        $this->assertContains(
            '--error',
            $arguments,
            'without --error Semgrep prints ERROR findings and exits zero, which is an informe and not a gate',
        );

        // Trivy: both scans block on HIGH and CRITICAL, and the dependency scan
        // only blocks on vulnerabilities that have a published fix.
        $this->assertSame(2, substr_count($workflow, '--severity HIGH,CRITICAL'));
        $this->assertSame(2, substr_count($workflow, '--exit-code 1'));
        $this->assertStringContainsString('--ignore-unfixed', $workflow);
        $this->assertStringContainsString('--ignorefile /repo/.trivyignore.yaml', $workflow);
        $this->assertStringContainsString('--scanners vuln', $workflow);

        // Gitleaks: the working tree on every event, the whole history when the
        // run is the scheduled or a manual one.
        $this->assertStringContainsString('dir /repo', $workflow);
        $this->assertStringContainsString('git /repo', $workflow);
        $this->assertStringContainsString('--log-opts=--all', $workflow);
        $this->assertStringContainsString("github.event_name == 'schedule'", $workflow);
        $this->assertStringContainsString('--config /repo/.gitleaks.toml', $workflow);
    }

    public function test_the_scanners_are_pinned_to_a_version_and_the_reports_survive_a_failure(): void
    {
        $workflow = $this->read(self::SECURITY_WORKFLOW);

        $this->assertStringNotContainsString(':latest', $workflow, 'a floating tag makes a failing gate indistinguishable from a new release');

        preg_match_all('/^\s+(SEMGREP_IMAGE|GITLEAKS_IMAGE|TRIVY_IMAGE): (\S+)$/m', $workflow, $pinned, PREG_SET_ORDER);
        $this->assertCount(3, $pinned, 'the three scanners have to declare their version in one place');

        foreach ($pinned as $entry) {
            $this->assertMatchesRegularExpression(
                '/:[v]?\d+\.\d+\.\d+$/',
                $entry[2],
                "{$entry[1]} must pin a released version, got '{$entry[2]}'",
            );
        }

        // The reports are what a failing gate leaves behind, so they have to be
        // uploaded even when the step that produced them failed. There is one
        // per scanner job: Semgrep's report, Gitleaks' reports and the two
        // Trivy reports.
        $this->assertSame(4, substr_count($workflow, 'if: always()'));
    }

    public function test_every_action_used_by_the_workflows_is_pinned_to_a_commit(): void
    {
        foreach ([self::CI_WORKFLOW, self::SECURITY_WORKFLOW, self::CODEQL_WORKFLOW] as $file) {
            // `uses:` carries a trailing comment with the human-readable tag,
            // so the pattern stops at the first space rather than at the end of
            // the line.
            preg_match_all('/^\s+uses: (\S+)/m', $this->read($file), $matches);
            $this->assertNotSame([], $matches[1], "{$file} uses no actions at all, which means it is not the workflow it claims to be");

            foreach ($matches[1] as $uses) {
                $this->assertMatchesRegularExpression(
                    '#^[^@\s]+@[0-9a-f]{40}$#',
                    $uses,
                    "{$file} pins {$uses} to something other than a commit: a moving tag is code that can change without review",
                );
            }
        }
    }

    public function test_codeql_analyzes_the_workflows_themselves(): void
    {
        $codeql = $this->read(self::CODEQL_WORKFLOW);

        // The workflows are the code that holds deploy tokens and secrets, and
        // they are neither PHP nor TypeScript. PHP has no CodeQL support, which
        // is why Semgrep carries that half.
        $this->assertMatchesRegularExpression(
            '/^\s+language: \[javascript-typescript, actions\]$/m',
            $codeql,
            'the Actions category is what analyzes .github/workflows/*.yml',
        );
        $this->assertStringContainsString('build-mode: none', $codeql);
        $this->assertStringContainsString('category: /language:${{ matrix.language }}', $codeql);
        $this->assertStringContainsString('fail-fast: false', $codeql, 'one language failing must not hide the other');
        $this->assertStringContainsString('queries: security-extended', $codeql);
    }

    public function test_the_static_analysis_document_names_every_gate(): void
    {
        $doc = $this->read(self::STATIC_ANALYSIS_DOC);

        foreach (['semgrep', 'gitleaks', 'trivy'] as $tool) {
            $this->assertStringContainsString($tool, strtolower($doc), "docs/static-analysis.md no longer documents {$tool}");
        }

        foreach (self::SEMGREP_RULESETS as $ruleset) {
            $this->assertStringContainsString($ruleset, $doc, "the documented rulesets drifted from the workflow: {$ruleset} is missing");
        }

        $this->assertStringContainsString('--severity ERROR', $doc);
        $this->assertStringContainsString('--severity HIGH,CRITICAL', $doc);
    }
}
