<?php

namespace App\Support;

/**
 * Lightweight, dependency-free user-agent parser. Approximates ua-parser-js for
 * the analytics fields (device / browser / os) used by the redirect hot path.
 */
class Ua
{
    /** Device value reserved for automated clients. */
    public const DEVICE_BOT = 'bot';

    /**
     * Signatures of clients that are not people. Matched case-insensitively as
     * substrings, which is why every one of them has to be something a browser
     * never sends: `bot` alone covers the crawlers that spell themselves out
     * (Googlebot, AhrefsBot, TelegramBot), and the rest are the automation
     * stacks and the uptime and security scanners that do not.
     *
     * Deliberately absent: `yandex` and `baidu` (Yandex Browser and Baidu's
     * in-app browser are people), `whatsapp` and `kakaotalk` (their in-app
     * browsers are people too, unlike their preview fetchers, which do say
     * `bot`), and bare `java/` (app-generated UAs of real browsers carry it).
     * A false positive here mislabels a human click, which is a worse error
     * than leaving an odd crawler in the desktop bucket.
     *
     * @var list<string>
     */
    private const BOT_SIGNATURES = [
        'bot', 'crawler', 'spider', 'slurp', 'ia_archiver', 'crawl',
        'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'lighthouse', 'gtmetrix',
        'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client', 'okhttp',
        'node-fetch', 'axios/', 'libwww-perl', 'apache-httpclient', 'postmanruntime',
        'insomnia/', 'httpx/', 'facebookexternalhit', 'embedly', 'quora link preview',
        'skypeuripreview', 'metauri', 'iframely', 'xing-contenttabreceiver', 'vkshare',
        'uptimerobot', 'pingdom', 'statuscake', 'zabbix', 'nagios', 'datadog',
        'newrelic', 'checkly', 'site24x7', 'monitoring',
        'nmap', 'masscan', 'sqlmap', 'nikto', 'zgrab', 'nuclei/', 'gobuster', 'wpscan',
        'censys', 'shodan', 'dataforseo', 'screaming frog', 'seznam',
    ];

    private static ?string $botPattern = null;

    /**
     * @return array{device: ?string, browser: ?string, os: ?string}
     */
    public static function parse(?string $ua): array
    {
        if (! $ua) {
            return ['device' => null, 'browser' => null, 'os' => null];
        }

        // Checked first, and returns nothing else: Googlebot's smartphone UA
        // says `Android` and `Mobile`, so a device check that ran before this
        // one would file a crawler as a person — which is exactly how `visitors`
        // and `devices` ended up counting traffic no human produced. The
        // crawler's browser and OS claims are dropped with it: they describe
        // what it pretends to be, and the human dimension maps are the point.
        if (self::isBot($ua)) {
            return ['device' => self::DEVICE_BOT, 'browser' => null, 'os' => null];
        }

        return [
            'device' => self::device($ua),
            'browser' => self::browser($ua),
            'os' => self::os($ua),
        ];
    }

    /** Whether a user agent belongs to an automated client. */
    public static function isBot(string $ua): bool
    {
        self::$botPattern ??= '/'.implode('|', array_map(
            static fn (string $signature): string => preg_quote($signature, '/'),
            self::BOT_SIGNATURES,
        )).'/i';

        return preg_match(self::$botPattern, $ua) === 1;
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
