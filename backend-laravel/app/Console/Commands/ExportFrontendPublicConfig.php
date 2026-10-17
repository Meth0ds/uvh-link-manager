<?php

namespace App\Console\Commands;

use App\Support\FrontendUrl;
use App\Support\LegalIdentity;
use Illuminate\Console\Command;

/** Emits only the explicit public allowlist needed by static prerendering. */
final class ExportFrontendPublicConfig extends Command
{
    protected $signature = 'uvh:frontend-public-config {--allow-incomplete : Local/test previews only}';

    protected $description = 'Export the public frontend build configuration without credentials';

    public function handle(): int
    {
        $identity = LegalIdentity::publicProjection((array) config('uvh.legal', []));
        if ($identity === null && ! ($this->option('allow-incomplete') && app()->environment(['local', 'testing']))) {
            $this->error('The public legal identity is incomplete. No build configuration was exported.');

            return self::FAILURE;
        }
        $publicOrigin = $this->origin((string) config('uvh.public_origin'));
        $appOrigin = $this->origin(FrontendUrl::base());
        if ($publicOrigin === null || $appOrigin === null) {
            $this->error('The public frontend origins are invalid. No build configuration was exported.');

            return self::FAILURE;
        }
        $this->line(json_encode([
            'publicOrigin' => $publicOrigin,
            'appOrigin' => $appOrigin,
            'legalIdentity' => $identity,
        ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }

    private function origin(string $value): ?string
    {
        $url = parse_url($value);
        if ($url === false || ! isset($url['scheme'], $url['host'])
            || ! in_array($url['scheme'], app()->environment('production') ? ['https'] : ['http', 'https'], true)
            || isset($url['user']) || isset($url['pass'])
            || isset($url['query']) || isset($url['fragment'])
            || ! in_array($url['path'] ?? '', ['', '/'], true)
            || preg_match('/[\x00-\x20\x7f]/', $value)) {
            return null;
        }

        return $url['scheme'].'://'.strtolower($url['host']).(isset($url['port']) ? ':'.$url['port'] : '');
    }
}
