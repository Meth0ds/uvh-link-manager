<?php

/**
 * DNS answers for tests that exercise the domain verification job.
 *
 * `VerifyDomainDnsJob` calls the global `dns_get_record()` unqualified from the
 * `App\Jobs` namespace, so a function declared here — in that same namespace —
 * is the one it resolves. That makes the whole verification path testable in
 * process, without a resolver and without the E2E fixture server.
 *
 * The stub is deliberately dumb: it answers what the test queued, keyed by the
 * queried name and type, and records every query so a test can assert which
 * names were looked up. Anything unqueued resolves to an empty answer, which is
 * what a resolver returns for a name that exists with no record of that type.
 *
 * Not autoloaded: include it with `require_once` from the test that needs it.
 * Nothing else in this repository may rely on it being loaded, because a stub
 * that leaks into another suite would silently replace real DNS.
 */

namespace App\Jobs;

final class DnsStub
{
    /**
     * Queued answers, keyed by "<name>|<type>".
     *
     * A value of `false` means the resolver itself failed, which the job is
     * required to treat as "no evidence" rather than "ownership gone".
     *
     * @var array<string, list<array<string, mixed>>|false>
     */
    private static array $answers = [];

    /** @var list<string> */
    private static array $queries = [];

    /** @param list<array<string, mixed>>|false $records */
    public static function answer(string $name, int $type, array|false $records): void
    {
        self::$answers[$name.'|'.$type] = $records;
    }

    /**
     * A TXT record exactly as `dns_get_record()` returns it: either one `txt`
     * string, or the `entries` chunks a long value is split into.
     *
     * @param  list<string>  $chunks
     */
    public static function txt(string $name, string|array $value): void
    {
        self::answer($name, DNS_TXT, [
            is_array($value) ? ['entries' => $value] : ['txt' => $value],
        ]);
    }

    public static function cname(string $name, string $target): void
    {
        self::answer($name, DNS_CNAME, [['target' => $target]]);
    }

    public static function fail(string $name, int $type): void
    {
        self::answer($name, $type, false);
    }

    /** @return list<string> */
    public static function queries(): array
    {
        return self::$queries;
    }

    public static function reset(): void
    {
        self::$answers = [];
        self::$queries = [];
    }

    /** @return list<array<string, mixed>>|false */
    public static function lookup(string $name, int $type): array|false
    {
        self::$queries[] = $name.'|'.$type;

        // An unqueued name is not an error: it is a name with no record.
        return self::$answers[$name.'|'.$type] ?? [];
    }
}

/**
 * The namespaced stand-in for the global resolver.
 *
 * PHP resolves an unqualified call inside a namespace to that namespace before
 * the global one, and this file is only ever loaded by the tests that intend to
 * replace resolution.
 *
 * @param  list<string>|null  $authoritativeNameServers
 * @param  list<array<string, mixed>>|null  $additionalRecords
 * @return list<array<string, mixed>>|false
 */
function dns_get_record(
    string $hostname,
    int $type = DNS_ANY,
    ?array &$authoritativeNameServers = null,
    ?array &$additionalRecords = null,
    bool $raw = false,
): array|false {
    return DnsStub::lookup($hostname, $type);
}
