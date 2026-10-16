<?php

namespace Tests\Feature;

use App\Exceptions\LinkException;
use App\Support\AppProviders;
use Tests\TestCase;

final class AppProviderFormatsTest extends TestCase
{
    public function test_official_content_formats_are_normalized_without_remote_discovery(): void
    {
        foreach (['track', 'album', 'artist', 'playlist', 'episode'] as $kind) {
            $url = 'https://open.spotify.com/'.$kind.'/4uLU6hMCjMI75M1A2tKUQC';
            self::assertSame($url, AppProviders::normalize('spotify', $url.'?si=remove-me'));
            self::assertSame($url, AppProviders::normalize('spotify', str_replace('/'.$kind.'/', '/intl-es/'.$kind.'/', $url)));
        }
        foreach (['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=shared', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ'] as $url) {
            self::assertSame('https://www.youtube.com/watch?v=dQw4w9WgXcQ', AppProviders::normalize('youtube', $url));
        }
        self::assertSame('https://www.youtube.com/playlist?list=PL1234567890', AppProviders::normalize('youtube', 'https://youtube.com/playlist?list=PL1234567890'));
        self::assertSame('https://www.google.com/maps/search/?api=1&query=Madrid', AppProviders::normalize('google_maps', 'https://www.google.com/maps/search/?api=1&query=Madrid&tracking=discarded'));
        self::assertSame('https://www.google.com/maps/dir/?api=1&destination=Madrid', AppProviders::normalize('google_maps', 'https://www.google.com/maps/dir/?api=1&destination=Madrid'));
        self::assertSame('https://maps.apple.com/?q=Madrid', AppProviders::normalize('apple_maps', 'https://maps.apple.com/?q=Madrid'));
        self::assertSame('https://maps.apple.com/?saddr=Toledo&daddr=Madrid', AppProviders::normalize('apple_maps', 'https://maps.apple.com/?saddr=Toledo&daddr=Madrid'));
    }

    public function test_unbounded_or_non_scalar_map_parameters_and_opaque_shorteners_are_refused(): void
    {
        foreach ([['google_maps', 'https://maps.app.goo.gl/example'], ['google_maps', 'https://www.google.com/maps/search/?api=1&query[]=a'], ['apple_maps', 'https://maps.apple.com/?q[]=a'], ['spotify', 'https://open.spotify.com/track/not-a-content-id'], ['youtube', 'https://www.youtube.com/watch?v=too-short']] as [$provider, $url]) {
            try {
                AppProviders::normalize($provider, $url);
                self::fail('An unsupported content URL was accepted');
            } catch (LinkException $e) {
                self::assertSame(422, $e->status);
            }
        }
    }
}
