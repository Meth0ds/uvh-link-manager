<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\PrivateArtifact;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** HTTP, SQL interleavings and encrypted fake artifacts; guarded *_test only. */
final class DataExportAdmissionBoundaryTest extends TestCase
{
    private const PASSWORD = 'fixture-password-for-export';

    private const CODE = 'ABCD2345EFGH6789';

    private const PATH = 'account-exports/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.uvh';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        Storage::fake('local');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'export-boundary-csrf')->withHeader('X-CSRF-Token', 'export-boundary-csrf');
        $this->freezeSecond();
    }

    private function actor(bool $mfa = true): array
    {
        $user = User::factory()->create(['password_hash' => Hash::make(self::PASSWORD)]);
        if ($mfa) {
            $user->forceFill(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'), 'recovery_codes' => [Ids::sha256Hex(self::CODE)]])->save();
        }
        $raw = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie((string) config('session.cookie'), $raw);

        return [$user, Ids::sha256Hex($raw)];
    }

    private function ready(User $user, string $sessionId): DataExportRequest
    {
        $plain = fopen('php://temp', 'r+b');
        fwrite($plain, '{"private":"export boundary fixture"}');
        rewind($plain);
        PrivateArtifact::write(self::PATH, $plain);
        fclose($plain);

        return DataExportRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'ready', 'artifact_path' => self::PATH,
            'mail_generation_hash' => Ids::sha256Hex('fixture-mail-generation'),
            'ready_at' => now(), 'download_expires_at' => now()->addHour(),
            'download_served_at' => now(), 'download_served_session_id' => $sessionId,
        ]);
    }

    private function requestSurface(string $surface): TestResponse
    {
        return match ($surface) {
            'status' => $this->getJson('/api/v1/auth/data-export'),
            'history' => $this->getJson('/api/v1/auth/data-export/history'),
            'request' => $this->postJson('/api/v1/auth/data-export', ['password' => self::PASSWORD, 'factorCode' => self::CODE]),
            'cancel' => $this->postJson('/api/v1/auth/data-export/cancel'),
            'download' => $this->post('/api/v1/auth/data-export/download', ['password' => self::PASSWORD, 'factorCode' => self::CODE]),
            'ack' => $this->postJson('/api/v1/auth/data-export/download/acknowledge'),
        };
    }

    private static function change(string $state, User $user, string $sessionId, User $other): void
    {
        match ($state) {
            'revoked' => DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]),
            'expired' => DB::table('sessions')->where('id', $sessionId)->update(['expires_at' => now()]),
            'session-version' => DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]),
            'foreign-owner' => DB::table('sessions')->where('id', $sessionId)->update(['user_id' => $other->id]),
            'blocked' => DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]),
            'unverified' => DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]),
            'account-version' => DB::table('users')->where('id', $user->id)->update(['security_version' => 2]),
            'unchanged' => null,
        };
    }

    public static function contexts(): array
    {
        $cases = [];
        foreach (['status', 'history', 'request', 'cancel', 'download', 'ack'] as $surface) {
            foreach (['revoked', 'expired', 'session-version', 'foreign-owner', 'blocked', 'unverified', 'account-version'] as $state) {
                $cases[$surface.' '.$state] = [$surface, $state];
            }
        }

        return $cases;
    }

    #[DataProvider('contexts')]
    public function test_authority_is_revalidated_after_middleware_hydration(string $surface, string $state): void
    {
        [$user, $sessionId] = $this->actor();
        $other = User::factory()->create();
        if ($surface !== 'request') {
            $this->ready($user, $sessionId);
        }
        $before = DB::table('data_export_requests')->orderBy('id')->get()->toJson();
        $codes = $user->recovery_codes;
        $injected = false;
        DB::listen(static function (QueryExecuted $query) use ($state, $user, $sessionId, $other, &$injected): void {
            $sql = strtolower($query->sql);
            if ($injected || ! str_starts_with($sql, 'select * from "users"') || str_contains($sql, 'for update')) {
                return;
            }
            // QueryExecuted runs after fetch: the middleware receives the old
            // authorized actor while the controller must observe the new state.
            $injected = true;
            self::change($state, $user, $sessionId, $other);
        });
        $response = $this->requestSurface($surface);
        $this->assertTrue($injected);
        $response->assertStatus(in_array($surface, ['status', 'history'], true) ? 401 : 409);
        $response->assertJsonMissingPath('export')->assertJsonMissingPath('exports')->assertCookieMissing('uvh_session');
        $this->assertSame($before, DB::table('data_export_requests')->orderBy('id')->get()->toJson());
        $this->assertSame($codes, $user->refresh()->recovery_codes);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        if ($surface !== 'request') {
            Storage::disk('local')->assertExists(self::PATH);
        }
        Queue::assertNothingPushed();
    }

    public static function ioContexts(): array
    {
        return array_map(static fn ($state) => [$state], ['unchanged', 'revoked', 'expired', 'session-version', 'foreign-owner', 'blocked', 'unverified', 'account-version']);
    }

    #[DataProvider('ioContexts')]
    public function test_download_preparation_revalidates_the_verified_actor_after_artifact_io(string $state): void
    {
        [$user, $sessionId] = $this->actor();
        $other = User::factory()->create();
        $row = $this->ready($user, $sessionId);
        $row->update(['download_served_at' => null, 'download_served_session_id' => null]);
        $disk = Storage::disk('local');
        $proxy = \Mockery::mock($disk);
        $proxy->shouldReceive('readStream')->once()->with(self::PATH)->andReturnUsing(static function (string $path) use ($state, $user, $sessionId, $other, $disk) {
            self::change($state, $user, $sessionId, $other);

            return $disk->readStream($path);
        });
        Storage::shouldReceive('disk')->with('local')->andReturn($proxy);
        $response = $this->requestSurface('download');
        if ($state === 'unchanged') {
            $response->assertOk();
            $this->assertSame('{"private":"export boundary fixture"}', $response->streamedContent());
        } else {
            $response->assertStatus(409);
            $this->assertNull($row->refresh()->download_served_at);
            $this->assertNull($row->download_served_session_id);
        }
        $this->assertSame('ready', $row->refresh()->status);
        $this->assertSame([], $user->refresh()->recovery_codes, 'The earlier step-up committed; denial after I/O must not imply rollback');
        $this->assertSame($state === 'unchanged' ? 1 : 0, DB::table('audit_events')->where('action', 'account.data_export_served')->count());
        $this->assertTrue($disk->exists(self::PATH));
        Queue::assertNothingPushed();
    }

    public static function deadlines(): array
    {
        $cases = [];
        foreach (['status', 'history', 'request', 'download', 'ack'] as $surface) {
            foreach ([-1, 0, 1, null] as $offset) {
                $cases[$surface.' deadline offset '.($offset ?? 'missing')] = [$surface, $offset];
            }
        }

        return $cases;
    }

    #[DataProvider('deadlines')]
    public function test_download_deadline_is_exclusive_across_all_export_surfaces(string $surface, ?int $offset): void
    {
        [$user, $sessionId] = $this->actor(false);
        $row = $this->ready($user, $sessionId);
        $row->update(['download_expires_at' => $offset === null ? null : now()->addSeconds($offset)]);
        $response = $this->requestSurface($surface);
        $expired = $offset === null || $offset <= 0;
        if (in_array($surface, ['status', 'history'], true)) {
            $response->assertOk()->assertJsonPath($surface === 'status' ? 'export.status' : 'exports.0.status', $expired ? 'expired' : 'ready');
            $this->assertSame('ready', $row->refresh()->status, 'Read projection does not mutate persisted state');
            Storage::disk('local')->assertExists(self::PATH);
        } elseif ($surface === 'request') {
            $response->assertStatus($expired ? 202 : 409);
            $this->assertSame($expired ? 'expired' : 'ready', $row->refresh()->status);
            $this->assertDatabaseCount('data_export_requests', $expired ? 2 : 1);
            if ($expired) {
                Queue::assertPushed(GenerateDataExportJob::class, 1);
                Storage::disk('local')->assertMissing(self::PATH);
            }
        } else {
            $response->assertStatus($expired ? 400 : 200);
            $this->assertSame($expired ? 'expired' : ($surface === 'ack' ? 'downloaded' : 'ready'), $row->refresh()->status);
            if ($surface === 'download' && ! $expired) {
                $this->assertSame('{"private":"export boundary fixture"}', $response->streamedContent());
            }
            if ($expired || $surface === 'ack') {
                Storage::disk('local')->assertMissing(self::PATH);
                $this->assertNull($row->refresh()->artifact_path);
            }
        }
    }
}
