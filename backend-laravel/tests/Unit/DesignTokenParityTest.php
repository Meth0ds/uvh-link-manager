<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * The visitor pages freeze the design tokens in PHP (`VisitorPage::styles()`)
 * because they share no stylesheet with the panel — and a palette of their own
 * is exactly how the identity got lost last time.
 *
 * The freeze is therefore not trusted: this contract keeps both palettes equal
 * in both colour schemes, so editing one side without the other fails CI
 * instead of silently drifting apart.
 */
class DesignTokenParityTest extends TestCase
{
    /**
     * Tokens both palettes share, as visitor-page name => SCSS name. The names
     * differ on purpose: the SCSS carries `uvh-` prefixes and legacy aliases
     * that a standalone page has no use for.
     */
    private const SHARED = [
        'paper' => 'paper',
        'raised' => 'paper-raised',
        'ink' => 'ink',
        'muted' => 'muted',
        'line' => 'line',
        'soft' => 'soft',
        'accent' => 'accent',
        'accent-ink' => 'accent-ink',
        'danger' => 'uvh-danger',
        'danger-soft' => 'uvh-danger-soft',
    ];

    public function test_visitor_pages_cannot_drift_away_from_the_design_tokens(): void
    {
        $scss = RepositoryRoot::read('frontend/src/app/core/_identity-tokens.scss');
        $php = RepositoryRoot::read('backend-laravel/app/Support/VisitorPage.php');
        $styles = $this->section($php, "<<<'CSS'", 'CSS;');

        $schemes = [
            'light' => [$this->section($scss, '@mixin light', '@mixin dark'), $this->section($styles, ':root{', '@media (prefers-color-scheme:dark)')],
            'dark' => [$this->section($scss, '@mixin dark', '@mixin aliases'), $this->section($styles, '@media (prefers-color-scheme:dark)', null)],
        ];

        foreach ($schemes as $scheme => [$scssSection, $visitorSection]) {
            $tokens = $this->tokens($scssSection);
            $pages = $this->tokens($visitorSection);
            foreach (self::SHARED as $visitorName => $scssName) {
                $this->assertArrayHasKey($scssName, $tokens, "the {$scheme} mixin no longer defines --{$scssName}");
                $this->assertArrayHasKey($visitorName, $pages, "the visitor {$scheme} palette no longer defines --{$visitorName}");
                $this->assertSame(
                    strtolower($tokens[$scssName]),
                    strtolower($pages[$visitorName]),
                    "--{$visitorName} (VisitorPage) and --{$scssName} (_identity-tokens.scss) diverged in {$scheme}",
                );
            }
        }
    }

    /** @return array<string, string> token name without `--` => hex colour */
    private function tokens(string $section): array
    {
        preg_match_all('/--([a-z][a-z0-9-]*)\s*:\s*(#[0-9a-fA-F]{3,8})\b/', $section, $matches, PREG_SET_ORDER);
        $tokens = [];
        foreach ($matches as $match) {
            $tokens[$match[1]] = $match[2];
        }

        return $tokens;
    }

    private function section(string $source, string $start, ?string $end): string
    {
        $from = strpos($source, $start);
        $this->assertNotFalse($from, "could not find [{$start}]");
        $slice = substr($source, $from);
        if ($end !== null) {
            $to = strpos($slice, $end);
            $this->assertNotFalse($to, "could not find [{$end}] after [{$start}]");
            $slice = substr($slice, 0, $to);
        }

        return $slice;
    }
}
