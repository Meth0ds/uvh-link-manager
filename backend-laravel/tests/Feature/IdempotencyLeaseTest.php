<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Idempotency;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * El arriendo de ejecución de las claves de idempotencia (F7-hotfix): una
 * reserva abandonada por un crash no atasca la clave 24 horas —el arriendo de
 * ejecución está separado de la ventana de replay— y el takeover es seguro:
 * el intento viejo ni sella ni libera la reserva del nuevo.
 */
final class IdempotencyLeaseTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, idempotency_keys RESTART IDENTITY CASCADE');
    }

    public function test_a_live_lease_rejects_a_concurrent_duplicate(): void
    {
        $user = User::factory()->create();
        $hash = Idempotency::hash('{"op":1}');
        $this->assertSame('fresh', Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-1', $hash)['state']);

        $second = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-1', $hash);
        $this->assertSame('in_progress', $second['state'], 'a running operation must not be applied twice in parallel');
    }

    public function test_an_abandoned_reservation_is_reclaimed_after_the_lease_expires(): void
    {
        $user = User::factory()->create();
        $hash = Idempotency::hash('{"op":1}');
        Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-2', $hash);

        // El proceso murió reservado: el arriendo vence sin que nadie selle.
        DB::table('idempotency_keys')->where('key', 'clave-arriendo-2')
            ->update(['lease_until' => now()->subMinute()]);

        $retry = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-2', $hash);
        $this->assertSame('fresh', $retry['state'], 'a crashed reservation must not block the key for 24 hours');
    }

    public function test_the_stale_attempt_neither_seals_nor_frees_the_reclaimed_reservation(): void
    {
        $user = User::factory()->create();
        $hash = Idempotency::hash('{"op":1}');
        $first = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-3', $hash);
        $staleLease = (string) $first['lease'];

        DB::table('idempotency_keys')->where('key', 'clave-arriendo-3')
            ->update(['lease_until' => now()->subMinute()]);
        $retry = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-3', $hash);
        $freshLease = (string) $retry['lease'];
        $this->assertNotSame($staleLease, $freshLease, 'the takeover must mint a new reservation token');

        // El intento viejo despierta tarde: ni sella su respuesta sobre la
        // reserva ajena ni la libera para que corra un tercero.
        Idempotency::commit((int) $user->id, 'links.bulk:1', 'clave-arriendo-3', $hash, 200, ['stale' => true], $staleLease);
        $this->assertNull(DB::table('idempotency_keys')->where('key', 'clave-arriendo-3')->value('response_status'));
        Idempotency::release((int) $user->id, 'links.bulk:1', 'clave-arriendo-3', $staleLease);
        $this->assertSame(1, DB::table('idempotency_keys')->where('key', 'clave-arriendo-3')->count());

        // El poseedor del arriendo actual sí sella.
        Idempotency::commit((int) $user->id, 'links.bulk:1', 'clave-arriendo-3', $hash, 200, ['ok' => true], $freshLease);
        $this->assertSame(200, (int) DB::table('idempotency_keys')->where('key', 'clave-arriendo-3')->value('response_status'));
    }

    public function test_the_sealed_response_replays_until_the_window_expires(): void
    {
        $user = User::factory()->create();
        $hash = Idempotency::hash('{"op":1}');
        $first = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-4', $hash);
        Idempotency::commit((int) $user->id, 'links.bulk:1', 'clave-arriendo-4', $hash, 200, ['applied' => 7], (string) $first['lease']);

        $replay = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-4', $hash);
        $this->assertSame('replay', $replay['state']);
        $this->assertSame(200, $replay['status']);
        $this->assertSame(['applied' => 7], $replay['body']);
    }

    public function test_the_same_key_with_another_body_is_a_mismatch(): void
    {
        $user = User::factory()->create();
        Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-5', Idempotency::hash('{"op":1}'));

        $other = Idempotency::begin((int) $user->id, 'links.bulk:1', 'clave-arriendo-5', Idempotency::hash('{"op":2}'));
        $this->assertSame('mismatch', $other['state']);
    }
}
