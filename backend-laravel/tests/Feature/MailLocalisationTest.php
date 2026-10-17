<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\FrontendUrl;
use App\Support\MailLanguage;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class MailLocalisationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['uvh.localisation_enabled' => true, 'uvh.frontend_url' => 'https://app.example.test']);
        app()->setLocale('es');
    }

    public function test_account_preference_is_used_and_does_not_leak_between_recipients(): void
    {
        $english = User::factory()->create(['language' => 'en']);
        $spanish = User::factory()->create(['language' => null]);
        $url = FrontendUrl::base().'/auth/reset-password#token=Opaque_Value-1&next=2';
        $this->assertTrue(UvhMail::resetPassword($english->email, $url, str_repeat('a', 64)));
        $this->assertSame('es', app()->getLocale());
        $this->assertTrue(UvhMail::resetPassword($spanish->email, $url, str_repeat('b', 64)));
        $rows = DB::table('mail_outbox')->orderBy('id')->get();
        $en = json_decode(UvhCrypto::decryptAtRest($rows[0]->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $es = json_decode(UvhCrypto::decryptAtRest($rows[1]->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame('en', $en['language']);
        $this->assertSame('Reset your UVH password', $en['subject']);
        $this->assertStringContainsString('<html lang="en-GB">', $en['html']);
        $this->assertStringContainsString('/en/auth/reset-password#token=Opaque_Value-1&next=2', $en['text']);
        $this->assertStringContainsString('help centre', $en['html']);
        $this->assertSame('es', $es['language']);
        $this->assertSame('Restablece tu contraseña en UVH', $es['subject']);
        $this->assertStringContainsString('/es/auth/reset-password#token=Opaque_Value-1&next=2', $es['text']);
    }

    public function test_changing_preference_does_not_rerender_an_existing_outbox_message(): void
    {
        $user = User::factory()->create(['language' => 'en']);
        $hash = str_repeat('c', 64);
        $url = FrontendUrl::base().'/auth/verify-email#token=opaque';
        $this->assertTrue(UvhMail::verification($user->email, $url, $hash));
        $original = DB::table('mail_outbox')->sole()->encrypted_envelope;
        $user->update(['language' => 'es']);
        $this->assertTrue(UvhMail::verification($user->email, $url, $hash));
        $this->assertSame(1, DB::table('mail_outbox')->count());
        $this->assertSame($original, DB::table('mail_outbox')->sole()->encrypted_envelope);
    }

    public function test_explicit_language_handles_new_mailboxes_and_escapes_user_content(): void
    {
        $this->assertTrue(UvhMail::invitation('new@example.test', FrontendUrl::base().'/auth/invitation#token=opaque', '<script>workspace</script>', 'viewer', 73, 'generation', 'en'));
        $mail = json_decode(UvhCrypto::decryptAtRest(DB::table('mail_outbox')->sole()->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame('You have a UVH team invitation', $mail['subject']);
        $this->assertStringContainsString('&lt;script&gt;workspace&lt;/script&gt;', $mail['html']);
        $this->assertStringNotContainsString('<script>', $mail['html']);
        $this->assertDoesNotMatchRegularExpression('/:value\d+/', $mail['html'].$mail['text']);
    }

    public function test_rendering_restores_locale_even_when_the_renderer_throws(): void
    {
        try {
            MailLanguage::render('new@example.test', function (): bool {
                $this->assertSame('en_GB', app()->getLocale());
                throw new \RuntimeException('Fixture');
            }, 'en');
            $this->fail('Expected rendering failure');
        } catch (\RuntimeException $error) {
            $this->assertSame('Fixture', $error->getMessage());
        }
        $this->assertSame('es', app()->getLocale());
    }

    public function test_localisation_never_rewrites_external_or_technical_urls(): void
    {
        app()->setLocale('en_GB');
        foreach (['https://other.test/auth/login#token=opaque', 'https://app.example.test.evil.test/auth/login', FrontendUrl::base().'/r/alias', FrontendUrl::base().'/api/v1/auth'] as $url) {
            $this->assertSame($url, FrontendUrl::localiseExistingPage($url));
        }
    }
}
