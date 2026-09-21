<?php

namespace Tests\Support;

use PHPUnit\Framework\Assert;

/**
 * The repository root, resolved once and refused when it cannot be trusted.
 *
 * Several contract tests describe files that live outside `backend-laravel/`:
 * the Compose topologies, the Dockerfiles, the CI workflows, the edge
 * configuration, the environment template. They used `dirname(__DIR__, 3)`,
 * which is only the repository root when the whole repository is checked out and
 * the suite runs from `backend-laravel/`.
 *
 * The documented QA command runs inside a container that mounts
 * `./backend-laravel` at `/app`, so that expression evaluated to `/`. The two
 * contracts that walk the repository then walked the *container* — `/proc`,
 * `/sys`, `/usr`, `/var` — at 100% CPU for minutes instead of failing, which is
 * how `composer test` stopped terminating at all. The others simply did not find
 * their files and failed with a message that named the wrong reason.
 *
 * Resolution order, both explicit:
 *
 *  1. `UVH_REPO_ROOT`, when the launcher knows the root: Compose sets it, CI
 *     sets it. A value that does not hold this repository fails here rather than
 *     quietly verifying nothing.
 *  2. Discovery: walk up from this file looking for the directory that holds the
 *     repository's own layout. This is what a plain `composer test` from
 *     `backend-laravel/` on a full checkout gets.
 *
 * A filesystem root is never a valid answer, and nothing here skips: a contract
 * that cannot find the repository must fail, not pass for the wrong reason.
 */
final class RepositoryRoot
{
    /**
     * Paths that only the repository root holds. `backend-laravel/composer.json`
     * is the one that matters: it is what tells the root apart from
     * `backend-laravel/` itself, and the other two keep a directory that merely
     * looks like a checkout from passing for it.
     */
    private const MARKERS = [
        'backend-laravel/composer.json',
        'docker-compose.local.yml',
        '.github/workflows/ci.yml',
    ];

    private static ?string $resolved = null;

    /** The absolute repository root. */
    public static function path(): string
    {
        return self::$resolved ??= self::resolve();
    }

    /**
     * A whole-file read from the repository root, with normalized line endings.
     *
     * A contract test that silently checks an empty string is worse than no
     * test, so a missing or empty file is a failure here.
     */
    public static function read(string $relative): string
    {
        $path = self::path().'/'.$relative;

        Assert::assertFileExists(
            $path,
            "{$relative} is part of a contract that describes the repository and must exist; a root that resolves without it is not the repository root.",
        );

        $contents = file_get_contents($path);
        Assert::assertIsString($contents, "{$relative} could not be read");
        Assert::assertNotSame('', trim($contents), "{$relative} is empty");

        return str_replace("\r\n", "\n", $contents);
    }

    private static function resolve(): string
    {
        $declared = getenv('UVH_REPO_ROOT');

        if (is_string($declared) && trim($declared) !== '') {
            return self::accept(trim($declared), 'UVH_REPO_ROOT');
        }

        // `tests/Support` -> `tests` -> `backend-laravel`: the walk starts at the
        // application root's parent, because the application root is never the
        // repository root.
        $candidate = dirname(__DIR__, 2);

        while (true) {
            $parent = dirname($candidate);

            if ($parent === $candidate) {
                break;
            }

            $candidate = $parent;

            if (self::holdsTheLayout($candidate)) {
                return $candidate;
            }
        }

        Assert::fail(
            'The repository root could not be resolved, so this contract cannot check the files it describes. '
            .'Run the suite from a full checkout (`composer test` inside `backend-laravel/`), or name the root '
            .'explicitly with UVH_REPO_ROOT. The documented container command mounts it read-only and sets that '
            .'variable for you; a container that only mounts `backend-laravel/` has no repository to check, and '
            .'resolving `/` would walk the whole container instead.',
        );
    }

    /** Validates an explicitly declared root instead of trusting it. */
    private static function accept(string $directory, string $source): string
    {
        $root = realpath($directory);
        Assert::assertIsString(
            $root,
            "{$source} is set to '{$directory}', which does not exist.",
        );

        Assert::assertTrue(
            self::holdsTheLayout($root),
            "{$source} is set to '{$directory}', which does not hold this repository: it has no "
            .implode(', ', self::MARKERS).'.',
        );

        return $root;
    }

    private static function holdsTheLayout(string $directory): bool
    {
        foreach (self::MARKERS as $marker) {
            if (! is_file($directory.'/'.$marker)) {
                return false;
            }
        }

        return true;
    }
}
