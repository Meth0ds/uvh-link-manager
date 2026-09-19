<?php

namespace App\Support;

/**
 * The suffixes under which a name is *not* registrable by itself.
 *
 * Matching a destination by label walks the labels of a host upwards: that is
 * what makes an entry for `evil.example` cover `pay.evil.example`, and what
 * keeps it from ever covering `notevil.example`. The walk has to stop somewhere,
 * and "the last label" is the wrong place to stop. For `evil.co.uk` the walk
 * produced `co.uk`, and for `x.github.io` it produced `github.io`: one entry
 * would then have disabled every site hosted under a public suffix or a shared
 * hosting platform — a typo in the moderation console with a blast radius no
 * operator intends.
 *
 * A full Public Suffix List is a large, frequently revised data file and this
 * project takes no runtime dependency it does not already ship, so what lives
 * here is a curated subset: the multi-label country suffixes and the shared
 * hosting platforms where the registrable unit is one label deeper than the
 * last one. It is a guardrail, not an oracle — an unlisted suffix behaves as
 * before (`host.example` still covers its subdomains), and the operator can
 * always block a concrete host.
 *
 * Updating it is a deliberate, reviewable act: add the suffix, move
 * `REVISED_AT` forward, and say why in the commit. `todos.md` carries the
 * reminder that this file ages.
 */
final class PublicSuffixes
{
    /** When the subset below was last reviewed against the public list. */
    public const REVISED_AT = '2026-09-15';

    /**
     * Multi-label suffixes. A host equal to one of these has no registrable
     * label of its own; a host one label above one of these is registrable.
     *
     * @var list<string>
     */
    private const SUFFIXES = [
        // Country-code suffixes that are themselves multi-label.
        'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'sch.uk',
        'com.au', 'edu.au', 'gov.au', 'net.au', 'org.au', 'id.au', 'asn.au',
        'co.nz', 'govt.nz', 'net.nz', 'org.nz', 'ac.nz', 'geek.nz', 'school.nz',
        'co.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp', 'ne.jp', 'or.jp',
        'co.kr', 'ac.kr', 'go.kr', 'ne.kr', 'or.kr', 're.kr',
        'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
        'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
        'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gob.ar',
        'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
        'com.pe', 'net.pe', 'org.pe', 'edu.pe', 'gob.pe',
        'com.ve', 'net.ve', 'org.ve', 'edu.ve', 'gob.ve',
        'com.ec', 'net.ec', 'org.ec', 'edu.ec', 'gob.ec',
        'com.uy', 'net.uy', 'org.uy', 'edu.uy', 'gub.uy',
        'com.py', 'net.py', 'org.py', 'edu.py', 'gov.py',
        'com.bo', 'net.bo', 'org.bo', 'edu.bo', 'gob.bo',
        'com.do', 'net.do', 'org.do', 'edu.do', 'gob.do',
        'com.gt', 'net.gt', 'org.gt', 'edu.gt', 'gob.gt',
        'co.za', 'net.za', 'org.za', 'gov.za', 'ac.za',
        'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'gov.in', 'edu.in', 'res.in',
        'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
        'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw', 'idv.tw',
        'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
        'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
        'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
        'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph',
        'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
        'co.th', 'in.th', 'or.th', 'ac.th', 'go.th', 'net.th',
        'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'sch.id', 'my.id',
        'com.tr', 'net.tr', 'org.tr', 'edu.tr', 'gov.tr', 'gen.tr', 'web.tr',
        'com.ua', 'net.ua', 'org.ua', 'edu.ua', 'gov.ua', 'in.ua',
        'co.il', 'net.il', 'org.il', 'ac.il', 'gov.il', 'muni.il',
        'com.sa', 'net.sa', 'org.sa', 'edu.sa', 'gov.sa', 'med.sa', 'sch.sa',
        'com.eg', 'net.eg', 'org.eg', 'edu.eg', 'gov.eg',
        'com.ng', 'net.ng', 'org.ng', 'edu.ng', 'gov.ng',
        'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke',
        'com.gh', 'org.gh', 'edu.gh', 'gov.gh',
        'com.pk', 'net.pk', 'org.pk', 'edu.pk', 'gov.pk',
        'com.bd', 'net.bd', 'org.bd', 'edu.bd', 'gov.bd',
        'com.np', 'net.np', 'org.np', 'edu.np', 'gov.np',
        'com.lk', 'net.lk', 'org.lk', 'edu.lk', 'gov.lk',
        'com.gr', 'net.gr', 'org.gr', 'edu.gr', 'gov.gr',
        'com.ro', 'net.ro', 'org.ro', 'nom.ro', 'info.ro',
        'com.bg', 'net.bg', 'org.bg', 'edu.bg', 'gov.bg',
        'com.ru', 'net.ru', 'org.ru', 'msk.ru', 'spb.ru',
        'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'waw.pl',
        'com.pt', 'net.pt', 'org.pt', 'edu.pt', 'gov.pt',
        'com.cy', 'net.cy', 'org.cy', 'gov.cy', 'ac.cy',
        'com.mt', 'net.mt', 'org.mt', 'edu.mt', 'gov.mt',
        'com.hr', 'net.hr', 'org.hr', 'from.hr',
        'com.az', 'net.az', 'org.az', 'edu.az', 'gov.az',
        'com.kz', 'net.kz', 'org.kz', 'edu.kz', 'gov.kz',
        'com.uz', 'net.uz', 'org.uz', 'co.uz',
        // Shared hosting and free-subdomain platforms: one registrable label,
        // then somebody else's site. `github.io` is a public suffix in the
        // official list for exactly this reason.
        'github.io', 'gitlab.io', 'bitbucket.io', 'readthedocs.io',
        'herokuapp.com', 'appspot.com', 'blogspot.com', 'web.app', 'firebaseapp.com',
        's3.amazonaws.com', 'cloudfront.net', 'azurewebsites.net', 'cloudapp.azure.com',
        'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
        'onrender.com', 'fly.dev', 'railway.app', 'up.railway.app', 'ondigitalocean.app',
        'glitch.me', 'repl.co', 'replit.app', 'surge.sh', 'wixsite.com', 'weebly.com',
        'wordpress.com', 'tumblr.com', 'squarespace.com', 'notion.site',
        'duckdns.org', 'no-ip.org', 'noip.me', 'ddns.net', 'dynu.net', 'hopto.org',
        'zapto.org', 'sytes.net', 'servebeer.com', 'myftp.org', 'ddnsfree.com',
        'ngrok.io', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com', 'loca.lt',
        'localtunnel.me', 'pipedream.net', 'ngrok.dev', 'share.zrok.io',
    ];

    /**
     * Longest listed suffix the host ends with, or null.
     *
     * Longest matters: `a.b.co.uk` must resolve to `co.uk` rather than to a
     * shorter, unrelated suffix, and a host equal to the suffix itself returns
     * it — the caller is the one that decides what that means.
     */
    public static function suffixOf(string $host): ?string
    {
        $host = strtolower(trim($host, '.'));
        if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return null;
        }

        $best = null;
        foreach (self::SUFFIXES as $suffix) {
            if ($host === $suffix || str_ends_with($host, '.'.$suffix)) {
                if ($best === null || strlen($suffix) > strlen($best)) {
                    $best = $suffix;
                }
            }
        }

        return $best;
    }

    /** Whether the host *is* a public suffix rather than something under one. */
    public static function isPublicSuffix(string $host): bool
    {
        return self::suffixOf($host) === strtolower(trim($host, '.'));
    }

    /**
     * Number of labels a candidate must keep above the public suffix.
     *
     * `evil.co.uk` needs the whole thing to stay a candidate; `co.uk` keeps
     * nothing and is not a host anyone can register.
     */
    public static function suffixLabels(string $host): int
    {
        $suffix = self::suffixOf($host);

        return $suffix === null ? 0 : substr_count($suffix, '.') + 1;
    }
}
