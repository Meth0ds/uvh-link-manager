<?php

namespace Tests\Feature;

use App\Support\NotificationKinds;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class MailPresentationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::table('mail_outbox')->delete();
        Queue::fake();
    }

    public function test_verification_mail_uses_the_current_identity_and_keeps_a_working_fallback_link(): void
    {
        $url = 'https://app.example.test/auth/verify-email#token=sample&next=1';
        $this->assertTrue(UvhMail::verification('recipient@example.test', $url, str_repeat('a', 64)));

        $mail = $this->envelope('verification');
        $this->assertSame('Verifica tu email en UVH', $mail['subject']);
        $this->assertSame("Verifica tu cuenta en UVH: {$url}", $mail['text']);
        $this->assertStringContainsString('uvh<span style="color:#b53c20;">.</span>', $mail['html']);
        $this->assertStringContainsString('Enlaces con recorrido.', $mail['html']);
        $this->assertStringContainsString('>Verificar mi email</a>', $mail['html']);
        $this->assertSame(2, substr_count($mail['html'], 'href="https://app.example.test/auth/verify-email#token=sample&amp;next=1"'));
        $this->assertStringNotContainsString('#2457F5', $mail['html']);
        $this->assertStringNotContainsString('Si no reconoces esta actividad', $mail['html']);
    }

    public function test_security_mail_keeps_its_distinctive_action_and_plain_text(): void
    {
        $url = 'https://app.example.test/auth/security-incident#token=sample';
        $this->assertTrue(UvhMail::passwordChanged('recipient@example.test', $url, str_repeat('b', 64)));

        $mail = $this->envelope('password_changed');
        $this->assertStringContainsString('background-color:#b12e30', $mail['html']);
        $this->assertStringContainsString('Cerrar accesos de emergencia', $mail['html']);
        $this->assertStringContainsString($url, $mail['text']);
        $this->assertStringContainsString('Si no reconoces esta acción', $mail['html']);
    }

    public function test_operational_link_mail_has_an_escaped_action_and_plain_text_without_credentials(): void
    {
        $url = 'https://app.example.test/app/links/7?workspaceId=3&source=notice';
        $this->assertTrue(UvhMail::operationalNotice('recipient@example.test', NotificationKinds::LINK_EXPIRING, '<b>Campaña</b> · Caduca pronto', $url));
        $mail = $this->envelope(NotificationKinds::LINK_EXPIRING);
        $this->assertStringContainsString('>Revisar enlace</a>', $mail['html']);
        $this->assertStringContainsString('&lt;b&gt;Campaña&lt;/b&gt;', $mail['html']);
        $this->assertStringNotContainsString('<b>Campaña</b>', $mail['html']);
        $this->assertSame(2, substr_count($mail['html'], 'href="https://app.example.test/app/links/7?workspaceId=3&amp;source=notice"'));
        $this->assertStringContainsString($url, $mail['text']);
        $this->assertStringNotContainsString('token=', $mail['html']);
    }

    public function test_other_operational_mail_keeps_the_generic_review_text(): void
    {
        $this->assertTrue(UvhMail::operationalNotice('recipient@example.test', NotificationKinds::API_TOKEN_EXPIRING, 'Token de integración'));
        $mail = $this->envelope(NotificationKinds::API_TOKEN_EXPIRING);
        $this->assertStringContainsString('Entra en UVH para revisar este aviso.', $mail['html']);
        $this->assertStringNotContainsString('>Revisar enlace</a>', $mail['html']);
    }

    /** @return array{to: string, subject: string, html: string, text: string} */
    private function envelope(string $kind): array
    {
        $row = DB::table('mail_outbox')->where('kind', $kind)->first();
        $this->assertNotNull($row);

        return json_decode(UvhCrypto::decryptAtRest($row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
    }
}
