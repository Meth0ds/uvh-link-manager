<?php

namespace App\Support;

use GuzzleHttp\Psr7\Uri;
use GuzzleHttp\Psr7\UriResolver;
use Illuminate\Support\Facades\DB;

/** Remote documents are data, never executable browser content. */
class DestinationInspector
{
    public function __construct(private readonly DestinationHttpTransport $transport) {}

    /** @return array{result: array<string, mixed>, icon: string|null} */
    public function inspect(string $url, string $mode): array
    {
        $domain = self::domain($url);
        $result = ['version' => 1, 'status' => 'not_checkable', 'httpStatus' => null, 'title' => null,
            'domain' => $domain, 'iconUrl' => null, 'checkedAt' => now()->toIso8601String(), 'reason' => null];
        $deadline = microtime(true) + min(8000, max(500, (int) config('destination-inspections.timeout_ms', 8000))) / 1000;
        try {
            self::assertInspectable($url);
            $method = $mode === 'preview' ? 'GET' : 'HEAD';
            [$response, $finalUrl] = $this->follow($url, $method, $deadline, $mode === 'preview' ? (int) config('destination-inspections.html_bytes', 524288) : 16384);
            if ($method === 'HEAD' && in_array($response['status'], [405, 501], true)) {
                [$response, $finalUrl] = $this->follow($url, 'GET', $deadline, 16384);
            }
            $status = $response['status'];
            $result['httpStatus'] = $status;
            $result['domain'] = self::domain($finalUrl);
            $result['status'] = match (true) {
                $status >= 200 && $status < 300 => 'reachable',
                in_array($status, [401, 403, 407, 429], true) => 'restricted',
                $status >= 400 => 'http_error',
                default => 'not_checkable',
            };
            $icon = null;
            $type = strtolower(explode(';', $response['headers']['content-type'] ?? '')[0]);
            if ($mode === 'preview' && $result['status'] === 'reachable' && $type === 'text/html') {
                [$result['title'], $iconUrl] = $this->metadata($response['body'], $finalUrl);
                if ($iconUrl !== null && microtime(true) < $deadline) {
                    try {
                        [$image] = $this->follow($iconUrl, 'GET', $deadline, (int) config('destination-inspections.icon_bytes', 262144));
                        if ($image['status'] >= 200 && $image['status'] < 300 && ! $image['truncated']) {
                            $icon = $this->normalizeIcon($image['body']);
                        }
                    } catch (\Throwable) {
                        // An optional icon never changes the document's result.
                    }
                }
            }

            return ['result' => $result, 'icon' => $icon];
        } catch (\Throwable $e) {
            $policy = (str_starts_with($e->getMessage(), 'SSRF:') && ! str_contains($e->getMessage(), 'resolver el host')) || $e->getMessage() === 'inspection_policy';
            $result['status'] = $policy ? 'not_checkable' : 'network_error';
            $result['reason'] = $policy ? 'policy' : 'connection';

            return ['result' => $result, 'icon' => null];
        }
    }

    public static function assertInspectable(string $url): void
    {
        if (! UrlUtil::validateDestination($url)['ok']) {
            throw new \RuntimeException('inspection_policy');
        }
        $host = self::domain($url);
        $managed = array_filter([
            strtolower(rtrim((string) config('uvh.public_host'), '.')),
            strtolower(rtrim((string) config('uvh.app_host'), '.')),
            self::domain((string) config('uvh.frontend_url')),
            self::domain((string) config('app.url')),
        ]);
        if (in_array($host, $managed, true) || DB::table('custom_domains')->whereRaw('lower(domain) = ?', [$host])->exists()) {
            throw new \RuntimeException('inspection_policy');
        }
        if (DestinationDenylist::reason($url) !== null) {
            throw new \RuntimeException('inspection_policy');
        }
    }

    public static function domain(string $url): string
    {
        $host = strtolower(rtrim(trim((string) parse_url($url, PHP_URL_HOST), '[]'), '.'));
        if (preg_match('/[^\x20-\x7e]/', $host) && function_exists('idn_to_ascii')) {
            $ascii = idn_to_ascii($host, IDNA_DEFAULT);
            if (is_string($ascii)) {
                $host = $ascii;
            }
        }

        return $host;
    }

    /** @return array{0: array{status: int, body: string, headers: array<string, string>, truncated: bool}, 1: string} */
    private function follow(string $url, string $method, float $deadline, int $maxBytes): array
    {
        for ($hop = 0; $hop <= 3; $hop++) {
            self::assertInspectable($url);
            $remaining = (int) (($deadline - microtime(true)) * 1000);
            if ($remaining <= 0) {
                throw new \RuntimeException('inspection_timeout');
            }
            $response = $this->transport->request($url, $method, $remaining, $maxBytes);
            if (! in_array($response['status'], [301, 302, 303, 307, 308], true)) {
                return [$response, $url];
            }
            $location = $response['headers']['location'] ?? '';
            if ($hop === 3 || $location === '' || strlen($location) > 2048 || preg_match('/[\x00-\x1f\x7f\\\\]/', $location)) {
                throw new \RuntimeException('inspection_policy');
            }
            $next = (string) UriResolver::resolve(new Uri($url), new Uri($location));
            if (strtolower((string) parse_url($url, PHP_URL_SCHEME)) === 'https' && strtolower((string) parse_url($next, PHP_URL_SCHEME)) !== 'https') {
                throw new \RuntimeException('inspection_policy');
            }
            $url = $next;
        }
        throw new \RuntimeException('inspection_policy');
    }

    /** @return array{0: string|null, 1: string|null} */
    private function metadata(string $html, string $url): array
    {
        // A byte cap alone still permits hundreds of thousands of tiny nodes.
        // Fail softly before libxml allocates a document larger than the worker.
        if (strlen($html) > 524288 || substr_count($html, '<') > 10000) {
            return [null, null];
        }
        $doc = new \DOMDocument;
        $previous = libxml_use_internal_errors(true);
        try {
            // No DTD loading, entity expansion, external resources or script execution.
            $loaded = $doc->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
            if (! $loaded) {
                return [null, null];
            }
            $title = $doc->getElementsByTagName('title')->item(0)?->textContent;
            if (is_string($title)) {
                $title = preg_replace('/[\p{Cc}\p{Cf}]/u', ' ', $title) ?? '';
                $title = mb_substr(trim(preg_replace('/\s+/u', ' ', $title) ?? ''), 0, 200);
            }
            $icon = null;
            $checked = 0;
            foreach ($doc->getElementsByTagName('link') as $node) {
                if (++$checked > 100) {
                    break;
                }
                if (preg_match('/(?:^|\s)icon(?:\s|$)/i', $node->getAttribute('rel'))) {
                    $href = $node->getAttribute('href');
                    if ($href !== '' && strlen($href) <= 2048 && ! preg_match('/[\x00-\x1f\x7f\\\\]/', $href)) {
                        try {
                            $icon = (string) UriResolver::resolve(new Uri($url), new Uri($href));
                        } catch (\InvalidArgumentException) {
                            // Remote optional metadata must not turn HTTP 200 into
                            // a connection failure or hide the document's title.
                            continue;
                        }
                        break;
                    }
                }
            }

            return [$title !== '' ? $title : null, $icon];
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function normalizeIcon(string $bytes): ?string
    {
        if (! function_exists('imagecreatefromstring') || strlen($bytes) > 262144) {
            return null;
        }
        $size = @getimagesizefromstring($bytes);
        if (! $size || ! in_array($size[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG], true)
            || $size[0] < 1 || $size[1] < 1 || $size[0] > 1024 || $size[1] > 1024) {
            return null;
        }
        $source = @imagecreatefromstring($bytes);
        if ($source === false) {
            return null;
        }
        $width = max(1, (int) round($size[0] * min(1, 128 / max($size[0], $size[1]))));
        $height = max(1, (int) round($size[1] * min(1, 128 / max($size[0], $size[1]))));
        $target = imagecreatetruecolor($width, $height);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefill($target, 0, 0, imagecolorallocatealpha($target, 255, 255, 255, 127));
        imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $size[0], $size[1]);
        ob_start();
        imagepng($target);
        $png = ob_get_clean();
        imagedestroy($source);
        imagedestroy($target);

        return is_string($png) ? $png : null;
    }
}
