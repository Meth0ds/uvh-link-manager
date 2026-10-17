<?php

namespace App\Support;

/** Exact published copy shown in the activation flow; no new personal data. */
final class LegalDocumentEvidence
{
    /** @return array{language: string, document_sha256: string} */
    public static function forVersion(string $type, string $version, string $language): array
    {
        if (! in_array($type, ['terms', 'privacy_notice'], true) || ! Language::valid($language)) {
            throw new \InvalidArgumentException('Unsupported legal evidence context');
        }
        $path = resource_path('localisation/legal-documents.json');
        if (! is_file($path) && app()->environment(['local', 'testing'])) {
            $path = rtrim((string) config('uvh.repository_root'), '/').'/shared/localisation/legal-documents.json';
        }
        $manifest = json_decode(file_get_contents($path), true, 16, JSON_THROW_ON_ERROR);
        $hash = $manifest[$type][$version][$language]['sha256'] ?? null;
        if (! is_string($hash) || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1) {
            throw new \RuntimeException('Published legal evidence is unavailable');
        }

        return ['language' => $language, 'document_sha256' => $hash];
    }
}
