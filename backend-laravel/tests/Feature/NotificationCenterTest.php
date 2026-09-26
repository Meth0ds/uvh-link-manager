<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * El centro de notificaciones contra su contrato: la bandeja es de la cuenta,
 * el catálogo es cerrado, las preferencias gobiernan sólo lo operativo —un
 * aviso crítico de credenciales, MFA, email, exportación o eliminación de
 * cuenta no se puede silenciar— y el resumen diario manda cada aviso una vez.
 */
final class NotificationCenterTest extends TestCase
{
    private const CSRF = 'notification-center-csrf';

    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeader('X-CSRF-Token', self::CSRF);
    }

    public function test_the_inbox_belongs_to_one_session_and_reads_back(): void
    {
        $user = $this->verifiedUser();
        $this->signIn($user);
        NotificationInbox::record((int) $user->id, NotificationKinds::PASSWORD_CHANGED);
        NotificationInbox::record((int) $user->id, NotificationKinds::MFA_ENABLED);

        $response = $this->getJson('/api/v1/notifications');
        $response->assertOk();
        $this->assertSame(2, $response->json('unread'));
        $rows = $response->json('notifications');
        $this->assertCount(2, $rows);
        $this->assertSame(NotificationKinds::MFA_ENABLED, $rows[0]['kind']);
        $this->assertNull($rows[0]['readAt']);
        $this->assertIsString($rows[0]['createdAt']);
        $this->assertSame('/app/settings/security', $rows[0]['route']);

        $this->postJson('/api/v1/notifications/'.$rows[0]['id'].'/read')
            ->assertOk()->assertExactJson(['unread' => 1]);
        $this->postJson('/api/v1/notifications/'.$rows[0]['id'].'/read')
            ->assertOk()->assertExactJson(['unread' => 1]);
        $this->postJson('/api/v1/notifications/read-all')
            ->assertOk()->assertExactJson(['unread' => 0]);

        $after = $this->getJson('/api/v1/notifications')->assertOk()->json('notifications');
        $this->assertTrue(collect($after)->every(fn (array $row): bool => is_string($row['readAt'])));
    }

    public function test_one_account_never_reads_or_marks_another_accounts_inbox(): void
    {
        $owner = $this->verifiedUser();
        $other = $this->verifiedUser();
        NotificationInbox::record((int) $owner->id, NotificationKinds::PASSWORD_CHANGED);
        $foreignId = (int) DB::table('notifications')->where('user_id', $owner->id)->value('id');
        $this->signIn($other);

        $response = $this->getJson('/api/v1/notifications')->assertOk();
        $this->assertSame([], $response->json('notifications'));
        $this->assertSame(0, $response->json('unread'));
        $this->postJson("/api/v1/notifications/{$foreignId}/read")
            ->assertStatus(404)->assertExactJson(['error' => 'Notificación no encontrada']);
    }

    public function test_account_deletion_notices_route_to_the_danger_section(): void
    {
        $user = $this->verifiedUser();
        $this->signIn($user);
        NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_SCHEDULED);
        NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_CANCELLED);

        $rows = $this->getJson('/api/v1/notifications')->assertOk()->json('notifications');
        $this->assertCount(2, $rows);
        // El aviso lleva a la sección donde vive la decisión irreversible.
        $this->assertSame(['/app/settings/danger', '/app/settings/danger'], array_column($rows, 'route'));
    }

    public function test_the_catalog_is_closed_to_unknown_kinds_and_wrong_scopes(): void
    {
        $user = $this->verifiedUser();

        $this->assertNull(NotificationInbox::record((int) $user->id, 'password_retyped'));
        // Un kind de cuenta rechaza la etiqueta de workspace: no se admite una
        // fila que una pantalla presentaría mal atribuida.
        $this->assertNull(NotificationInbox::record((int) $user->id, NotificationKinds::PASSWORD_CHANGED, 1, 'ACME'));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $user->id)->count());
    }

    public function test_operational_preferences_govern_the_row_and_the_mail(): void
    {
        $user = $this->verifiedUser();

        // Sin preferencias, el comportamiento es el de siempre: fila y correo.
        $this->assertSame(
            NotificationPreferences::DELIVERY_IMMEDIATE,
            NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1'),
        );
        $this->assertTrue(NotificationPreferences::wantsMail((int) $user->id, NotificationKinds::API_TOKEN_CREATED));

        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        $this->assertSame(
            NotificationPreferences::DELIVERY_DAILY_DIGEST,
            NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-2', 'api_token_created:2'),
        );
        $this->assertFalse(NotificationPreferences::wantsMail((int) $user->id, NotificationKinds::API_TOKEN_CREATED));

        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'in_app_only']);
        $this->assertSame(
            NotificationPreferences::DELIVERY_IN_APP_ONLY,
            NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-3', 'api_token_created:3'),
        );

        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'disabled']);
        $this->assertNull(NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-4', 'api_token_created:4'));

        // Lo registrado antes de cambiar de idea no se borra; lo nuevo obedece.
        $this->assertSame(3, DB::table('notifications')->where('user_id', $user->id)->count());
    }

    public function test_a_critical_notice_cannot_be_silenced_even_by_a_planted_preference(): void
    {
        $user = $this->verifiedUser();
        $this->signIn($user);

        $this->patchJson('/api/v1/notifications/preferences', [
            'preferences' => [['kind' => NotificationKinds::PASSWORD_CHANGED, 'delivery' => 'disabled']],
        ])->assertStatus(422)->assertExactJson(['error' => 'Los avisos de seguridad no se pueden desactivar']);

        // Ni siquiera una fila plantada a mano gobierna un kind obligatorio.
        DB::table('notification_preferences')->insert([
            'user_id' => $user->id,
            'kind' => NotificationKinds::MFA_DISABLED,
            'delivery' => 'disabled',
            'updated_at' => now(),
        ]);
        $this->assertSame(
            NotificationPreferences::DELIVERY_IMMEDIATE,
            NotificationInbox::record((int) $user->id, NotificationKinds::MFA_DISABLED),
        );
        $this->assertTrue(NotificationPreferences::wantsMail((int) $user->id, NotificationKinds::MFA_DISABLED));
        $this->assertSame(1, DB::table('notifications')->where('user_id', $user->id)->count());
    }

    public function test_preferences_validate_the_whole_batch_and_audit_the_change(): void
    {
        $user = $this->verifiedUser();
        $this->signIn($user);

        $view = $this->patchJson('/api/v1/notifications/preferences', [
            'preferences' => [
                ['kind' => NotificationKinds::WORKSPACE_DELETED, 'delivery' => 'disabled'],
                ['kind' => NotificationKinds::ACCOUNT_RECOVERY_REJECTED, 'delivery' => 'daily_digest'],
            ],
        ])->assertOk()->json('preferences');

        $byKind = collect($view)->keyBy('kind');
        $this->assertSame('disabled', $byKind[NotificationKinds::WORKSPACE_DELETED]['delivery']);
        $this->assertSame('daily_digest', $byKind[NotificationKinds::ACCOUNT_RECOVERY_REJECTED]['delivery']);
        $this->assertSame(NotificationKinds::CATEGORY_OPERATIONAL, $byKind[NotificationKinds::WORKSPACE_DELETED]['category']);
        // Todo el catálogo se devuelve, obligatorios incluidos con su entrega fija.
        $this->assertSame(count(NotificationKinds::all()), count($view));
        $this->assertSame('immediate', $byKind[NotificationKinds::PASSWORD_CHANGED]['delivery']);

        $this->assertDatabaseHas('audit_events', [
            'user_id' => $user->id,
            'action' => 'account.notification_preferences_updated',
        ]);

        // El lote se valida entero: lo inválido no deja ni el cambio bueno.
        $this->patchJson('/api/v1/notifications/preferences', [
            'preferences' => [
                ['kind' => NotificationKinds::API_TOKEN_CREATED, 'delivery' => 'in_app_only'],
                ['kind' => 'ghost_kind', 'delivery' => 'disabled'],
            ],
        ])->assertStatus(422)->assertExactJson(['error' => 'Datos inválidos']);
        $this->assertSame(
            NotificationPreferences::DELIVERY_IMMEDIATE,
            NotificationPreferences::deliveryFor((int) $user->id, NotificationKinds::API_TOKEN_CREATED),
        );

        $this->patchJson('/api/v1/notifications/preferences', [
            'preferences' => [['kind' => NotificationKinds::API_TOKEN_CREATED, 'delivery' => 'por_búzón']],
        ])->assertStatus(422)->assertExactJson(['error' => 'Datos inválidos']);
    }

    public function test_the_daily_digest_mails_each_pending_notice_once(): void
    {
        $user = $this->verifiedUser();
        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-2', 'api_token_created:2');
        // Dedupe: la misma identidad lógica no se registra dos veces.
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');
        $this->assertSame(2, DB::table('notifications')->whereNull('digested_at')->count());

        $this->artisan('uvh:notifications-digest')->assertSuccessful();

        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
        $this->assertSame(0, DB::table('notifications')->whereNull('digested_at')->count());

        // Una segunda pasada no repite el correo: lo pendiente ya está sellado.
        $this->artisan('uvh:notifications-digest')->assertSuccessful();
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
    }

    public function test_changing_a_preference_retires_what_was_pending_for_the_digest(): void
    {
        $user = $this->verifiedUser();
        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');

        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'in_app_only']);

        $this->assertSame(0, DB::table('notifications')->whereNull('digested_at')->count());
        $this->artisan('uvh:notifications-digest')->assertSuccessful();
        $this->assertSame(0, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
    }

    public function test_the_digest_never_mails_a_notice_whose_preference_already_retired_it(): void
    {
        // La ventana de carrera exacta de la revisión: la preferencia cambia
        // DESPUÉS de que el digest hubiera leído las filas —aquí plantada sin el
        // sellado que el cambio real hace—. El claim debe revalidar bajo lock
        // y retirar el aviso en vez de mandar un correo que la cuenta pidió
        // silenciar.
        $user = $this->verifiedUser();
        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');

        DB::table('notification_preferences')
            ->where('user_id', $user->id)
            ->where('kind', NotificationKinds::API_TOKEN_CREATED)
            ->update(['delivery' => NotificationPreferences::DELIVERY_IN_APP_ONLY]);

        $this->artisan('uvh:notifications-digest')->assertSuccessful();

        $this->assertSame(0, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
        $this->assertSame(0, DB::table('notifications')->whereNull('digested_at')->count(), 'the retired notice must be sealed, never mailed');
    }

    public function test_a_crash_between_outbox_admission_and_seal_cannot_duplicate_the_digest(): void
    {
        // El crash del que habla la revisión: el correo queda admitido y el
        // sellado no llega. La clave del outbox es determinista —misma cuenta y
        // mismos avisos—, así que la pasada que encuentra las filas otra vez
        // pendientes choca en la misma clave y no duplica el resumen.
        $user = $this->verifiedUser();
        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-2', 'api_token_created:2');

        $this->artisan('uvh:notifications-digest')->assertSuccessful();
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());

        DB::table('notifications')->update(['digested_at' => null]);

        $this->artisan('uvh:notifications-digest')->assertSuccessful();
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'notification_digest')->count(), 'the retry of the same claim must not duplicate the summary');
        $this->assertSame(0, DB::table('notifications')->whereNull('digested_at')->count());
    }

    public function test_a_failed_outbox_admission_leaves_the_claim_untouched(): void
    {
        $user = $this->verifiedUser();
        NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
        NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-1', 'api_token_created:1');

        // Admisión del outbox interrumpida: la transacción del claim revierte
        // entera —ni correo, ni sellado del aviso— y la próxima pasada lo
        // reintenta intacto.
        DB::listen(static function (QueryExecuted $event): void {
            if (str_starts_with(strtolower($event->sql), 'insert') && str_contains($event->sql, '"mail_outbox"')) {
                throw new \RuntimeException('Fixture: outbox admission interrupted');
            }
        });

        $this->artisan('uvh:notifications-digest')->assertSuccessful();

        $this->assertSame(0, DB::table('mail_outbox')->count());
        $this->assertSame(1, DB::table('notifications')->whereNull('digested_at')->count(), 'a failed admission must not seal the claim');
    }

    public function test_a_run_digests_at_most_two_hundred_accounts(): void
    {
        // El tope de la pasada es operacional: la consulta elige primero los
        // candidatos y nunca carga el backlog entero. La cuenta 201 espera a la
        // siguiente pasada.
        for ($i = 0; $i < 201; $i++) {
            $user = User::factory()->create();
            NotificationPreferences::update((int) $user->id, [NotificationKinds::API_TOKEN_CREATED => 'daily_digest']);
            NotificationInbox::record((int) $user->id, NotificationKinds::API_TOKEN_CREATED, null, 'tok-'.$i, 'api_token_created:'.$i);
        }

        $this->artisan('uvh:notifications-digest')->assertSuccessful();

        $this->assertSame(200, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
        $this->assertSame(1, DB::table('notifications')->whereNull('digested_at')->count());

        $this->artisan('uvh:notifications-digest')->assertSuccessful();
        $this->assertSame(201, DB::table('mail_outbox')->where('kind', 'notification_digest')->count());
    }

    public function test_a_password_change_reaches_the_inbox_and_the_outbox(): void
    {
        $user = $this->verifiedUser();
        $this->signIn($user);

        $this->postJson('/api/v1/auth/change-password', [
            'current' => self::PASSWORD,
            'newPassword' => 'otro-tiovivo-cobrizo-astilla-43',
        ])->assertOk();

        $this->assertDatabaseHas('notifications', [
            'user_id' => $user->id,
            'kind' => NotificationKinds::PASSWORD_CHANGED,
        ]);
        $this->assertDatabaseHas('mail_outbox', ['kind' => 'password_changed']);
    }

    private function verifiedUser(): User
    {
        return User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD),
            'email_verified_at' => now(),
        ]);
    }

    private function signIn(User $user): void
    {
        $this->withCookie((string) config('session.cookie'), SessionManager::create(
            $user->id,
            Request::create('/'),
            (int) $user->refresh()->security_version,
        ));
    }
}
