<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Auth\RegistrationAdmission;
use App\Support\LegalDocumentEvidence;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class LegalDocumentLanguageTest extends TestCase
{
    public function test_activation_records_the_exact_english_documents_without_changing_their_versions(): void
    {
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['uvh.localisation_enabled' => true]);
        app()->setLocale('en_GB');
        RegistrationAdmission::start('amelia@example.test');
        $row = DB::table('mail_outbox')->sole();
        $mail = json_decode(UvhCrypto::decryptAtRest($row->encrypted_envelope), true, 32, JSON_THROW_ON_ERROR);
        $this->assertSame('en', $mail['language']);
        $this->assertSame(1, preg_match('/#token=([A-Za-z0-9_-]+)/', $mail['text'], $matches));
        $userId = RegistrationAdmission::activate($matches[1], 'orbit-magnolia-copper-47!', 'Amelia Owner');
        $this->assertIsInt($userId);
        $user = User::findOrFail($userId);
        $this->assertSame('en', $user->language);
        $this->assertSame('Workspace for Amelia Owner', $user->ownedWorkspaces()->sole()->name);
        $acceptances = DB::table('legal_acceptances')->where('user_id', $userId)->get();
        $this->assertCount(2, $acceptances);
        foreach ($acceptances as $acceptance) {
            $this->assertSame('en', $acceptance->language);
            $this->assertSame('2026-10-09', $acceptance->version);
            $this->assertSame(LegalDocumentEvidence::forVersion($acceptance->document_type, $acceptance->version, 'en')['document_sha256'], $acceptance->document_sha256);
        }
        $this->assertNull(RegistrationAdmission::activate($matches[1], 'orbit-magnolia-copper-47!', 'Amelia Owner'));
        $this->assertSame(2, DB::table('legal_acceptances')->where('user_id', $userId)->count());
    }

    public function test_older_evidence_remains_unchanged_when_the_account_language_changes(): void
    {
        $user = User::factory()->create();
        DB::table('legal_acceptances')->insert(['user_id' => $user->id, 'document_type' => 'terms', 'version' => 'legacy-fixture', 'source' => 'registration', 'accepted_at' => now()]);
        $user->update(['language' => 'en']);
        $row = DB::table('legal_acceptances')->where('user_id', $user->id)->where('version', 'legacy-fixture')->sole();
        $this->assertNull($row->language);
        $this->assertNull($row->document_sha256);
    }

    public function test_an_unknown_document_version_cannot_receive_fabricated_evidence(): void
    {
        $this->expectException(\RuntimeException::class);
        LegalDocumentEvidence::forVersion('terms', 'unknown', 'en');
    }
}
