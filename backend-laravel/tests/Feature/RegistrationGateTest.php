<?php

namespace Tests\Feature;

use App\Support\RegistrationGate;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class RegistrationGateTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::table('operational_settings')->where('key', RegistrationGate::KEY)->delete();
        Cache::flush();
    }

    public function test_defaults_to_open_when_no_row_exists(): void
    {
        $this->assertFalse(RegistrationGate::isPaused());
        $this->assertDatabaseMissing('operational_settings', ['key' => RegistrationGate::KEY]);
    }

    public function test_set_paused_persists_invalidates_stale_cache_and_audits(): void
    {
        $this->assertFalse(RegistrationGate::isPaused());

        // La lectura anterior deja la caché en `false`; una escritura directa
        // simula el valor obsoleto que la invalidación debe enterrar.
        DB::table('operational_settings')->where('key', RegistrationGate::KEY)->delete();
        DB::table('operational_settings')->insert([
            'key' => RegistrationGate::KEY,
            'value_bool' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertFalse(RegistrationGate::isPaused(), 'la caché debe seguir sirviendo el valor anterior hasta invalidar');

        $this->assertTrue(RegistrationGate::setPaused(true, null, null));
        $this->assertTrue(RegistrationGate::isPaused());
        $this->assertDatabaseHas('operational_settings', ['key' => RegistrationGate::KEY, 'value_bool' => true]);
        $this->assertDatabaseHas('audit_events', ['action' => 'admin.registration_pause']);

        $this->assertFalse(RegistrationGate::setPaused(false, null, null));
        $this->assertFalse(RegistrationGate::isPaused());
        $this->assertDatabaseHas('operational_settings', ['key' => RegistrationGate::KEY, 'value_bool' => false]);
    }

    public function test_cache_ttl_is_clamped(): void
    {
        config(['uvh.operational_settings_cache_seconds' => 100000]);
        $this->assertSame(300, RegistrationGate::cacheTtlSeconds());
        config(['uvh.operational_settings_cache_seconds' => 0]);
        $this->assertSame(5, RegistrationGate::cacheTtlSeconds());
    }
}
