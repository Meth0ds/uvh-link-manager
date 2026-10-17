<?php

namespace App\Support;

use App\Exceptions\LinkException;

/** Closed adapters: no untrusted schemes, intent strings or remote discovery. */
final class AppProviders
{
    public const LABELS = ['spotify' => 'Spotify', 'youtube' => 'YouTube', 'google_maps' => 'Google Maps', 'apple_maps' => 'Apple Maps'];

    public static function normalize(string $provider, mixed $input): string
    {
        if (! isset(self::LABELS[$provider]) || ! is_string($input) || ! UrlUtil::validateDestination($input)['ok']) {
            throw new LinkException(__('messages.error_73ea36c480808d'), 422);
        }
        $parts = parse_url($input);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user'], $parts['pass']) || isset($parts['user']) || isset($parts['port']) || isset($parts['fragment'])) {
            throw new LinkException(__('messages.error_e689e3be3e6c98'), 422);
        }
        $host = strtolower($parts['host'] ?? '');
        $path = $parts['path'] ?? '/';
        parse_str($parts['query'] ?? '', $query);
        if ($provider === 'spotify' && $host === 'open.spotify.com' && preg_match('~^/(?:intl-[a-z]{2}/)?(track|album|artist|playlist|episode)/([A-Za-z0-9]{22})/?$~D', $path, $m)) {
            return 'https://open.spotify.com/'.$m[1].'/'.$m[2];
        }
        if ($provider === 'youtube') {
            $video = $host === 'youtu.be' ? trim($path, '/') : ($path === '/watch' ? ($query['v'] ?? null) : null);
            if (in_array($host, ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'], true) && is_string($video) && preg_match('/^[A-Za-z0-9_-]{11}$/D', $video)) {
                return 'https://www.youtube.com/watch?v='.$video;
            }
            if (in_array($host, ['www.youtube.com', 'youtube.com', 'm.youtube.com'], true) && preg_match('~^/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})$~D', $path, $m)) {
                return 'https://www.youtube.com/watch?v='.$m[1];
            }
            $list = $query['list'] ?? null;
            if (in_array($host, ['www.youtube.com', 'youtube.com', 'm.youtube.com'], true) && $path === '/playlist' && is_string($list) && preg_match('/^[A-Za-z0-9_-]{10,150}$/D', $list)) {
                return 'https://www.youtube.com/playlist?list='.$list;
            }
        }
        if ($provider === 'google_maps' && in_array($host, ['www.google.com', 'google.com'], true) && in_array(rtrim($path, '/'), ['/maps/search', '/maps/dir'], true) && ($query['api'] ?? null) === '1') {
            $allowed = $path === '/maps/search/' || rtrim($path, '/') === '/maps/search' ? ['api', 'query', 'query_place_id'] : ['api', 'origin', 'origin_place_id', 'destination', 'destination_place_id', 'travelmode', 'waypoints', 'waypoint_place_ids', 'dir_action'];
            $required = rtrim($path, '/') === '/maps/search' ? 'query' : 'destination';
            if (is_string($query[$required] ?? null) && trim($query[$required]) !== '') {
                return 'https://www.google.com'.rtrim($path, '/').'/?'.self::query($query, $allowed);
            }
        }
        if ($provider === 'apple_maps' && $host === 'maps.apple.com' && $path === '/' && (isset($query['q']) || isset($query['daddr']) || isset($query['ll']))) {
            return 'https://maps.apple.com/?'.self::query($query, ['q', 'address', 'll', 'sll', 'saddr', 'daddr', 'dirflg', 't', 'z']);
        }
        throw new LinkException(__('messages.error_f2f30c24bcff2c'), 422);
    }

    /** @param array<string, mixed> $input
     * @param  list<string>  $allowed
     */
    private static function query(array $input, array $allowed): string
    {
        $result = [];
        foreach ($allowed as $key) {
            if (! array_key_exists($key, $input)) {
                continue;
            }
            $value = $input[$key];
            if (! is_string($value) || strlen($value) > 1000 || preg_match('/[\x00-\x1f\x7f]/', $value)) {
                throw new LinkException(__('messages.error_5f144df32b6522'), 422);
            }
            $result[$key] = $value;
        }

        return http_build_query($result, '', '&', PHP_QUERY_RFC3986);
    }
}
