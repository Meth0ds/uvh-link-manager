<?php

namespace App\Support\Auth;

use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Models\User;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\RegistrationEdit;
use App\Support\UvhMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Context, address claim, generation, bearer, mail and audit share admission. */
final class RegistrationEmailCorrection
{
    /** @return array{status: 'ok'|'unavailable', attempt: RegistrationAttempt|null} */
    public static function admit(Request $request, RegistrationAttempt $snapshot, string $currentEmail, string $newEmail): array
    {
        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        $verificationUrl = FrontendUrl::base().'/auth/verify-email#token='.rawurlencode($token);

        return DB::transaction(function () use ($request, $snapshot, $currentEmail, $newEmail, $tokenHash, $verificationUrl): array {
            $attempt = RegistrationAttemptContext::lock($snapshot);
            if (! $attempt || ! RegistrationAttemptContext::authorizes($request, $attempt, $currentEmail)) {
                return ['status' => 'unavailable', 'attempt' => null];
            }
            $pending = $attempt->pending_registration_id
                ? PendingRegistration::whereKey($attempt->pending_registration_id)->lockForUpdate()->first()
                : null;
            if ($pending && (int) $pending->security_version !== $attempt->pending_security_version) {
                return ['status' => 'unavailable', 'attempt' => null];
            }
            EmailAddressLock::acquire($newEmail);
            $taken = User::whereRaw('lower(email) = ?', [$newEmail])->exists()
                || PendingRegistration::when($pending, fn ($query) => $query->where('id', '!=', $pending->id))
                    ->whereRaw('lower(email) = ?', [$newEmail])->exists()
                || EmailChangeRequest::whereRaw('lower(new_email) = ?', [$newEmail])->where('expires_at', '>', now())->exists();

            if ($pending) {
                // Every ACK spends the legacy pending generation too, including
                // a taken destination. Its mailbox/bearers change only on a move.
                $pending->update([
                    'email' => $taken ? $pending->email : $newEmail,
                    'security_version' => (int) $pending->security_version + 1,
                    'updated_at' => now(),
                ]);
            } elseif (! $taken) {
                // A previously occupied or activated context can start a NEW
                // pending row, never attach/mutate an existing account or row.
                $pending = PendingRegistration::create(['email' => $newEmail, 'security_version' => 1]);
            }
            $attempt->update([
                'email' => $newEmail,
                'security_version' => (int) $attempt->security_version + 1,
                'expires_at' => RegistrationEdit::deadline(),
                'pending_registration_id' => $pending?->id,
                'pending_security_version' => $pending?->security_version,
                'legacy_consumed_at' => now(),
            ]);
            if (! $taken && $pending) {
                EmailToken::where('pending_registration_id', $pending->id)->where('kind', 'verify')->whereNull('used_at')->delete();
                EmailToken::create(['id' => $tokenHash, 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addDay()]);
            }
            // Occupied destinations pay for the same admission, with no bearer
            // behind the hash: delivery eligibility suppresses that envelope.
            if (! UvhMail::verification($newEmail, $verificationUrl, $taken ? Ids::sha256Hex(Ids::randomToken(32)) : $tokenHash)) {
                throw new MailAdmissionException('Registration email correction outbox admission failed');
            }
            Audit::write(null, $taken ? 'auth.registration_email_change_conflict' : 'auth.registration_email_change', 'pending_registration', $pending ? (string) $pending->id : null);

            return ['status' => 'ok', 'attempt' => $attempt];
        });
    }
}
