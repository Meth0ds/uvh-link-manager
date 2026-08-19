<?php

namespace App\Support;

/**
 * Lightweight, dependency-free user-agent parser. Approximates ua-parser-js for
 * the analytics fields (device / browser / os) used by the redirect hot path.
 */
class Ua
{
    /**
     * @return array{device: ?string, browser: ?string, os: ?string}
     */
    public static function parse(?string $ua): array
    {
        if (! $ua) {
            return ['device' => null, 'browser' => null, 'os' => null];
        }

        $device = self::device($ua);
        $browser = self::browser($ua);
        $os = self::os($ua);

        return ['device' => $device, 'browser' => $browser, 'os' => $os];
    }

    private static function device(string $ua): string
    {
        if (preg_match('/ipad|tablet|playbook|silk/i', $ua)) {
            return 'tablet';
        }
        if (preg_match('/mobi|iphone|ipod|android|opera mini|blackberry|windows phone/i', $ua)) {
            return 'mobile';
        }

        return 'desktop';
    }

    private static function browser(string $ua): ?string
    {
        if (preg_match('/(?:edg|edge|edga|edgios)\/([0-9.]+)/i', $ua)) {
            return 'Edge';
        }
        if (preg_match('/opr\/|opera/i', $ua)) {
            return 'Opera';
        }
        if (preg_match('/chrome\/|crios\/|chromium/i', $ua)) {
            return 'Chrome';
        }
        if (preg_match('/firefox\/|fxios/i', $ua)) {
            return 'Firefox';
        }
        if (preg_match('/version\/[^ ]*safari|safari\//i', $ua)) {
            return 'Safari';
        }
        if (preg_match('/msie|trident/i', $ua)) {
            return 'IE';
        }

        return null;
    }

    private static function os(string $ua): ?string
    {
        if (preg_match('/windows nt 10/i', $ua)) {
            return 'Windows';
        }
        if (preg_match('/windows/i', $ua)) {
            return 'Windows';
        }
        if (preg_match('/android/i', $ua)) {
            return 'Android';
        }
        if (preg_match('/iphone|ipad|ipod/i', $ua)) {
            return 'iOS';
        }
        if (preg_match('/mac os x|macintosh/i', $ua)) {
            return 'Mac OS';
        }
        if (preg_match('/linux/i', $ua)) {
            return 'Linux';
        }

        return null;
    }
}
