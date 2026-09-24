<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * `uvh:e2e:reset-limits` must clear spent budgets and NOTHING else.
 *
 * The E2E fixture used to run `cache:clear`, whose comment promised "the
 * counters, and only the counters" while the command wiped the whole store —
 * MFA challenges, TOTP replay guards, domain-verification dedupe and every
 * application cache included. That is broader than its word and can hide
 * cross-step cache interactions that would exist in a real deployment. This
 * pins the narrow contract: the two budget namespaces die, everything else
 * survives.
 */
final class E2eResetLimitsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE cache');
        // One store behind every role, so the run exercises the deletion logic
        // once without needing a Redis server in the unit suite. The Redis path
        // is the one the E2E stack runs before every case.
        config([
            'cache.default' => 'database',
            'cache.limiter' => 'database',
            'cache.limiter_security' => 'database',
        ]);
    }

    public function test_it_clears_budgets_and_only_budgets(): void
    {
        $store = Cache::store('database');

        // Spent budgets: the two MfaAttempts levels and the hashed Laravel
        // rate-limiter keys (md5 hex, sha1 hex, with their :timer companions),
        // plus the unhashed `uvh-…` spelling in case hashing is disabled.
        $budgets = [
            'uvh:mfa:attempts:totp:5',
            'uvh:mfa:attempts:global:5',
            'uvh:mfa:attempts:totp:5:timer',
            md5('uvh-login'.'login-ip:127.0.0.1'),
            md5('uvh-login'.'login-ip:127.0.0.1').':timer',
            sha1('uvh.es|127.0.0.1'),
            'uvh-login:login-ip:127.0.0.1',
        ];

        // Not budgets: in-flight auth state and application caches are the
        // system's behaviour, not the harness's spend.
        $keepers = [
            'uvh:mfa:challenge:abc123',
            'uvh:mfa:totp-used:5:JBSW:12345',
            'uvh:health:queue',
            'uvh:webhook-config:9',
            'uvh:domain-verification:1:2',
            'aplicacion:llave-propia',
        ];

        foreach ([...$budgets, ...$keepers] as $key) {
            $store->put($key, 1, 600);
        }

        $this->artisan('uvh:e2e:reset-limits')->assertExitCode(0);

        foreach ($budgets as $key) {
            $this->assertNull($store->get($key), "the budget [{$key}] must be reset");
        }
        foreach ($keepers as $key) {
            $this->assertNotNull($store->get($key), "the non-budget [{$key}] must survive the reset");
        }
    }

    public function test_a_failover_chain_is_reset_through_its_members_and_never_itself(): void
    {
        // The E2E stack counts availability budgets on the `failover` chain,
        // and that chain is exactly where the first E2E run of this command
        // died: FailoverStore refuses per-key deletion (it picks a healthy
        // member; it does not speak key by key), so the command must walk the
        // members and never hand the chain name to resetStore().
        config([
            'cache.limiter' => 'failover',
            // One member is enough to pin the decomposition — the unit suite
            // has no Redis. The E2E stack runs the two-member chain.
            'cache.stores.failover.stores' => ['database'],
        ]);

        $store = Cache::store('database');
        $budget = md5('uvh-login'.'login-ip:127.0.0.1');
        $keeper = 'uvh:mfa:challenge:en-vuelo';
        $store->put($budget, 5, 600);
        $store->put($keeper, 1, 600);

        $this->artisan('uvh:e2e:reset-limits')->assertExitCode(0);

        $this->assertNull($store->get($budget), 'the budget on the chain member must be reset');
        $this->assertNotNull($store->get($keeper), 'the non-budget must survive the reset');
    }
}
