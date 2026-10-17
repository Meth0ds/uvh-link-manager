<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\NotificationSubject;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class NotificationLocalisationTest extends TestCase
{
    public function test_structured_subject_changes_language_without_translating_the_resource_name(): void
    {
        $data = ['version' => 1, 'type' => 'expiry', 'label' => 'Carta de Navidad', 'expiresAt' => '2026-12-25T18:30:00Z'];
        app()->setLocale('en_GB');
        $this->assertSame('Carta de Navidad · Expires on 25 Dec 2026, 18:30 UTC', NotificationSubject::render('legacy', $data));
        $data = ['version' => 1, 'type' => 'remaining', 'label' => 'Carta de Navidad', 'remaining' => 1];
        $this->assertSame('Carta de Navidad · 1 click remaining', NotificationSubject::render('legacy', $data));
        $data['remaining'] = 0;
        $this->assertSame('Carta de Navidad · 0 clicks remaining', NotificationSubject::render('legacy', $data));
        app()->setLocale('es');
        $this->assertSame('Carta de Navidad · 0 clics disponibles', NotificationSubject::render('legacy', $data));
    }

    public function test_legacy_and_unrecognised_payloads_remain_literal(): void
    {
        app()->setLocale('en_GB');
        foreach ([null, ['version' => 2], ['version' => 1, 'type' => 'arbitrary.key', 'label' => 'Example']] as $data) {
            $this->assertSame('Nombre sin traducir', NotificationSubject::render('Nombre sin traducir', $data));
        }
    }

    public function test_inbox_uses_request_language_not_the_original_worker_language(): void
    {
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        config(['uvh.localisation_enabled' => true]);
        $user = User::factory()->create(['email_verified_at' => now(), 'language' => 'es']);
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        NotificationInbox::record($user->id, NotificationKinds::LINK_LIMIT_APPROACHING, null, 'Carta · 1 clic disponible', 'language-test', null,
            ['version' => 1, 'type' => 'remaining', 'label' => 'Carta', 'remaining' => 1]);
        $this->withCookie('uvh_session', $session)->withHeader('Accept-Language', 'en-GB')
            ->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('notifications.0.subject', 'Carta · 1 click remaining');
        $this->withHeader('Accept-Language', 'es-ES')->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('notifications.0.subject', 'Carta · 1 clic disponible');
        $this->assertSame('Carta · 1 clic disponible', DB::table('notifications')->sole()->subject);
    }
}
