<?php

namespace Tests\Unit;

use App\Support\Ua;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Crawlers are not people, and the metrics are the reason it matters.
 *
 * `Ua::parse()` fed `device`, `browser` and `os` straight into the daily rollup,
 * and a crawler that says Chrome on Android was counted as exactly that: a
 * person. The device check even ran before anything else, so Googlebot's
 * smartphone UA — which does contain `Android` and `Mobile` — landed in the
 * mobile bucket. Every `arrival` and `visitors` figure in the panel included
 * traffic nobody produced.
 */
final class UaTest extends TestCase
{
    /**
     * @return list<array{string}>
     */
    public static function botAgents(): array
    {
        return [
            ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
            // Contains Android and Mobile: the case that made bots look human.
            ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
            ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
            ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
            ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36'],
            ['curl/8.4.0'],
            ['Wget/1.21.4'],
            ['python-requests/2.31.0'],
            ['Go-http-client/1.1'],
            ['Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
            ['Mozilla/5.0 (compatible; Pingdom.com_bot_version_1.4; http://www.pingdom.com/)'],
            ['Mozilla/5.0 zgrab/0.x'],
            ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
            ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
            ['TelegramBot (like TwitterBot)'],
        ];
    }

    #[DataProvider('botAgents')]
    public function test_an_automated_client_is_labelled_as_one(string $ua): void
    {
        $parsed = Ua::parse($ua);

        $this->assertSame(Ua::DEVICE_BOT, $parsed['device']);
        // Its browser and OS claims describe what it pretends to be, so they do
        // not reach the human dimensions either.
        $this->assertNull($parsed['browser']);
        $this->assertNull($parsed['os']);
    }

    /**
     * @return list<array{string, string, string, string}>
     */
    public static function humanAgents(): array
    {
        return [
            [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'desktop', 'Chrome', 'Windows',
            ],
            [
                'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
                'mobile', 'Chrome', 'Android',
            ],
            [
                'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/604.1',
                'tablet', 'Safari', 'iOS',
            ],
            // In-app browsers are people: the vendor name alone is not a reason
            // to call a click robotic, which is why the signatures list only the
            // fetchers that spell themselves out.
            [
                'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/440.0.0.26.119;]',
                'mobile', 'Chrome', 'Android',
            ],
            [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
                'desktop', 'Firefox', 'Windows',
            ],
        ];
    }

    #[DataProvider('humanAgents')]
    public function test_a_person_is_still_classified_the_way_it_was(string $ua, string $device, string $browser, string $os): void
    {
        $this->assertTrue(Ua::isBot($ua) === false);

        $parsed = Ua::parse($ua);
        $this->assertSame($device, $parsed['device']);
        $this->assertSame($browser, $parsed['browser']);
        $this->assertSame($os, $parsed['os']);
    }

    public function test_a_missing_user_agent_is_absent_and_not_a_crawler(): void
    {
        // No header at all is unknown, not automated: the rollup distinguishes
        // "nobody said" from "a crawler said".
        $this->assertSame(['device' => null, 'browser' => null, 'os' => null], Ua::parse(null));
        $this->assertSame(['device' => null, 'browser' => null, 'os' => null], Ua::parse(''));

        $parsed = Ua::parse(str_repeat('A', 600));
        $this->assertSame('desktop', $parsed['device']);
    }
}
