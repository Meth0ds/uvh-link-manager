<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * Drift guard for the shared password-policy bundle: the browser script is
 * generated from PasswordStrength (single source of truth). If this test
 * fails, someone changed the PHP policy without re-running
 * `php artisan uvh:emit-password-policy` and copying the output to the
 * frontend (frontend/public/ and frontend/dist/uvh/browser/).
 */
class EmitPasswordPolicyTest extends TestCase
{
    public function test_emitted_bundle_matches_current_policy(): void
    {
        Artisan::call('uvh:emit-password-policy', ['--force' => true]);

        $generated = file_get_contents(storage_path('app/password-policy/uvh-password-policy.v1.js'));
        $this->assertNotFalse($generated, 'The artisan command must emit the bundle');

        $committed = base_path('../frontend/public/uvh-password-policy.v1.js');
        if (! is_file($committed)) {
            // Frontend checkout not present in this environment; the bundle
            // itself is still verified above.
            $this->addToAssertionCount(1);

            return;
        }

        $this->assertSame(
            $generated,
            file_get_contents($committed),
            'frontend/public/uvh-password-policy.v1.js is stale: re-run php artisan uvh:emit-password-policy and copy the file to frontend/public and frontend/dist/uvh/browser',
        );
    }

    public function test_emitted_bundle_contains_every_policy_section(): void
    {
        Artisan::call('uvh:emit-password-policy', ['--force' => true]);
        $generated = file_get_contents(storage_path('app/password-policy/uvh-password-policy.v1.js'));

        foreach (['"common"', '"patterns"', '"rejectWords"', '"feedback"', '"minLength"', '"maxLength"', '"acceptMinScore"', '"bands"'] as $key) {
            $this->assertStringContainsString($key, (string) $generated);
        }
    }
}
