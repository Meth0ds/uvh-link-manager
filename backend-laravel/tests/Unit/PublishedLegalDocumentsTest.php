<?php

namespace Tests\Unit;

use App\Support\Auth\RegistrationAdmission;
use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

final class PublishedLegalDocumentsTest extends TestCase
{
    public function test_registration_versions_match_the_frontend_and_public_copies(): void
    {
        $root = RepositoryRoot::path();
        $frontend = file_get_contents($root.'/frontend/src/app/core/legal-documents.ts');
        $this->assertIsString($frontend);
        foreach ([
            'TERMS_VERSION' => ['terminos', RegistrationAdmission::TERMS_VERSION],
            'PRIVACY_VERSION' => ['privacidad', RegistrationAdmission::PRIVACY_VERSION],
        ] as $constant => [$slug, $version]) {
            $this->assertStringContainsString('export const '.$constant.' = "'.$version.'";', $frontend);
            $directory = $root.'/frontend/public/legal/versions/'.$version;
            $manifest = json_decode(file_get_contents($directory.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
            $copy = file_get_contents($directory.'/'.$slug.'.html');
            $this->assertSame($version, $manifest[$slug]['version']);
            $this->assertSame(hash('sha256', $copy), $manifest[$slug]['sha256']);
            $this->assertCount(20, $manifest[$slug]['anchors']);
            foreach ($manifest[$slug]['anchors'] as $anchor) {
                $this->assertSame(1, substr_count($copy, 'id="'.$anchor.'"'));
            }
        }
    }

    public function test_published_copies_preserve_every_current_clause_and_the_prior_versions_remain_accessible(): void
    {
        $root = RepositoryRoot::path();
        foreach ([['terms', 'terminos', RegistrationAdmission::TERMS_VERSION], ['privacy', 'privacidad', RegistrationAdmission::PRIVACY_VERSION]] as [$name, $slug, $version]) {
            $template = file_get_contents($root.'/frontend/src/app/legal/'.$name.'.component.html');
            $copy = file_get_contents($root.'/frontend/public/legal/versions/'.$version.'/'.$slug.'.html');
            preg_match_all('/<section class="doc-section".*?<\/section>/s', $template, $sections);
            $this->assertCount(20, $sections[0]);
            foreach ($sections[0] as $clause) {
                // SPA navigation changes the attribute, never the clause itself.
                $this->assertStringContainsString(str_replace('routerLink=', 'href=', $clause), $copy);
            }
            $prior = $root.'/frontend/public/legal/versions/2026-08-30/'.$slug.'.html';
            $this->assertFileExists($prior);
            $this->assertStringContainsString('Versión 2026-08-30', file_get_contents($prior));
            $this->assertNotSame('2026-08-30', $version);
        }
    }
}
