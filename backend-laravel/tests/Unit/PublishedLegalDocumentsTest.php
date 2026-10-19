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
            // Angular localisation markers do not alter the published legal wording.
            $template = preg_replace('/<\/?ng-container(?:\s+i18n="[^"]*")?>/', '', $template);
            $template = preg_replace('/\s+i18n(?:-[a-z-]+)?="[^"]*"/', '', $template);
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

    public function test_english_copies_have_their_own_integrity_and_point_to_the_unchanged_spanish_source(): void
    {
        $directory = RepositoryRoot::path().'/frontend/public/legal/versions/2026-10-09';
        $es = json_decode(file_get_contents($directory.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        $en = json_decode(file_get_contents($directory.'/en/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach (['terms' => 'terminos', 'privacy' => 'privacidad'] as $slug => $source) {
            $copy = file_get_contents($directory.'/en/'.$slug.'.html');
            $this->assertSame('en-GB', $en[$slug]['language']);
            $this->assertSame($es[$source]['sha256'], $en[$slug]['sourceSha256']);
            $this->assertSame(hash('sha256', $copy), $en[$slug]['sha256']);
            $this->assertSame($es[$source]['anchors'], $en[$slug]['anchors']);
            $this->assertStringContainsString('<html lang="en-GB">', $copy);
            $this->assertStringNotContainsString('<script', $copy);
            $this->assertStringNotContainsString('i18n=', $copy);
            $this->assertStringContainsString('noindex,nofollow', $copy);
        }
    }

    public function test_french_copies_are_registered_as_published_static_documents(): void
    {
        $directory = RepositoryRoot::path().'/frontend/public/legal/versions/2026-10-09';
        $es = json_decode(file_get_contents($directory.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        $fr = json_decode(file_get_contents($directory.'/fr/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        $registry = json_decode(file_get_contents(RepositoryRoot::path().'/shared/localisation/legal-documents.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach (['terms' => 'terminos', 'privacy' => 'privacidad'] as $slug => $source) {
            $copy = file_get_contents($directory.'/fr/'.$slug.'.html');
            $this->assertIsString($copy);
            $this->assertSame('fr-FR', $fr[$slug]['language']);
            $this->assertSame('es-ES', $fr[$slug]['sourceLanguage']);
            $this->assertSame($es[$source]['sha256'], $fr[$slug]['sourceSha256']);
            $this->assertSame(hash('sha256', $copy), $fr[$slug]['sha256']);
            $this->assertSame($es[$source]['anchors'], $fr[$slug]['anchors']);
            $this->assertStringContainsString('<html lang="fr-FR">', $copy);
            $this->assertStringNotContainsString('<script', $copy);
            $this->assertStringNotContainsString('i18n=', $copy);
            $this->assertStringContainsString('noindex,nofollow', $copy);
            $entry = $registry[$slug === 'terms' ? 'terms' : 'privacy_notice']['2026-10-09']['fr'];
            $this->assertSame('/legal/versions/2026-10-09/fr/'.$slug.'.html', $entry['path']);
            $this->assertSame($fr[$slug]['sha256'], $entry['sha256']);
            foreach ($fr[$slug]['anchors'] as $anchor) {
                $this->assertSame(1, substr_count($copy, 'id="'.$anchor.'"'));
            }
        }
    }
}
