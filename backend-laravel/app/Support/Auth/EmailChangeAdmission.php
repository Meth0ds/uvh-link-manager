<?php

namespace App\Support\Auth;

use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\MailAdmissionException;
use App\Support\MfaStepUp;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\SecurityContext;
use App\Support\UvhMail;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Email reservation, proof and credential changes retain their complete commits. */
final class EmailChangeAdmission
{
    /** @return array{status: string, user_id?: int, expires_at?: Carbon, factor?: string} */
    public static function request(User $user, ?string $sessionId, string $newEmail, string $password, string $factorCode, string $tokenHash, string $verificationUrl): array
    {
        return DB::transaction(function () use ($user, $sessionId, $newEmail, $password, $factorCode, $tokenHash, $verificationUrl): array {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return ['status' => 'stale'];
            }
            $locked = $context->user;
            $session = $context->session;
            // One shared step-up owns the attempt budget, the freshness
            // window and replay protection. Business conflicts only become
            // visible afterwards, so a caller without a valid factor cannot
            // probe which addresses are taken.
            $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, true, 'email-change');
            if ($stepUp['status'] !== 'ok') {
                return ['status' => $stepUp['status']];
            }
            EmailAddressLock::acquire($newEmail);
            if (strtolower($locked->email) === $newEmail) {
                return ['status' => 'same'];
            }
            if (User::where('id', '!=', $locked->id)->whereRaw('lower(email) = ?', [$newEmail])->exists()) {
                return ['status' => 'conflict'];
            }

            // Refuse a live foreign claim before deleting our own. Two
            // owners exchanging reservations would otherwise wait on each
            // other's unique-index entries. Throw to roll back freshness,
            // matching the existing unique-constraint conflict path.
            if (EmailChangeRequest::where('user_id', '!=', $locked->id)
                ->whereRaw('lower(new_email) = ?', [$newEmail])
                ->where('expires_at', '>', now())->exists()) {
                throw new EmailChangeReservationConflict('Destination reservation is active');
            }

            // Expired reservations must not occupy an email indefinitely.
            EmailChangeRequest::where('expires_at', '<=', now())
                ->where(function ($query) use ($locked, $newEmail) {
                    $query->where('user_id', $locked->id)->orWhereRaw('lower(new_email) = ?', [$newEmail]);
                })->delete();

            EmailChangeRequest::where('user_id', $locked->id)->lockForUpdate()->first()?->delete();

            // The recovery code is charged only on the created path: a
            // same/conflict answer keeps the credential intact for a retry.
            if (isset($stepUp['recovery_codes'])) {
                $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
            }

            $expiresAt = now()->addHour();
            EmailChangeRequest::create([
                'id' => $tokenHash,
                'user_id' => $locked->id,
                'new_email' => $newEmail,
                'security_version' => (int) $locked->security_version,
                'expires_at' => $expiresAt,
                'created_at' => now(),
            ]);
            if (! UvhMail::emailChangeVerification($newEmail, $verificationUrl, $tokenHash)) {
                throw new MailAdmissionException('Email change verification outbox admission failed');
            }
            // The previous mailbox must receive a durable warning in the
            // same commit as the new mailbox's bearer. If either admission
            // fails, retain the previous reservation and recovery code.
            NotificationInbox::record((int) $locked->id, NotificationKinds::EMAIL_CHANGE_REQUESTED);
            if (! UvhMail::emailChangeRequested($locked->email)) {
                throw new MailAdmissionException('Email change warning outbox admission failed');
            }

            Audit::write($locked->id, 'auth.email_change_requested', 'user', $locked->id, [
                'factor' => $stepUp['factor'],
                'expires_in_minutes' => 60,
            ]);

            return [
                'status' => 'created',
                'user_id' => (int) $locked->id,
                'expires_at' => $expiresAt,
                'factor' => $stepUp['factor'],
            ];
        });
    }

    public static function cancel(User $user, ?string $sessionId, string $password, string $factorCode): string
    {
        return DB::transaction(function () use ($user, $sessionId, $password, $factorCode): string {
            $context = SecurityContext::lock($user, $sessionId);
            if ($context === null) {
                return 'stale';
            }
            $locked = $context->user;
            $session = $context->session;
            // Same shared step-up as the request it cancels: account-wide
            // budget, freshness window and replay protection in one place.
            $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, true, 'email-change');
            if ($stepUp['status'] !== 'ok') {
                return $stepUp['status'];
            }
            if (isset($stepUp['recovery_codes'])) {
                $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
            }
            EmailChangeRequest::where('user_id', $locked->id)->delete();
            Audit::write($locked->id, 'auth.email_change_cancelled', 'user', $locked->id);

            return 'ok';
        });
    }

    /** @return array{status: string, user_id?: int} */
    public static function confirm(EmailChangeRequest $snapshot, string $tokenHash): array
    {
        return DB::transaction(function () use ($snapshot, $tokenHash): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = EmailChangeRequest::where('id', $tokenHash)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $row) {
                return ['status' => 'invalid'];
            }
            if ($row->expires_at->lte(now())) {
                $row->delete();

                return ['status' => 'expired'];
            }

            if (! $user || $user->deleted_at || ! $user->email_verified_at
                || (int) $user->security_version !== (int) $row->security_version) {
                $row->delete();

                return ['status' => 'invalid'];
            }
            EmailAddressLock::acquire(strtolower($row->new_email));
            // Un registro pendiente posee su dirección tanto como una
            // cuenta: dejar esta reclamación sobre ella dejaría dos
            // titulares y una activación que crearía un segundo usuario con
            // el mismo correo.
            if (User::where('id', '!=', $user->id)->whereRaw('lower(email) = ?', [strtolower($row->new_email)])->exists()
                || PendingRegistration::whereRaw('lower(email) = ?', [strtolower($row->new_email)])->exists()) {
                $row->delete();

                return ['status' => 'conflict'];
            }

            $now = now();
            $oldEmail = $user->email;
            $newEmail = strtolower($row->new_email);
            $nextVersion = (int) $user->security_version + 1;
            $user->update([
                'email' => $newEmail,
                'email_verified_at' => $now,
                'security_version' => $nextVersion,
                'updated_at' => $now,
            ]);
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            EmailToken::where('user_id', $user->id)->whereIn('kind', ['verify', 'reset'])->whereNull('used_at')->delete();
            EmailChangeRequest::where('user_id', $user->id)->delete();
            AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);
            // Both identity-change notices belong to this commit. Failure
            // on the second mailbox also rolls back the first envelope;
            // neither mailbox may be told about a change that was undone.
            NotificationInbox::record((int) $user->id, NotificationKinds::EMAIL_CHANGED);
            foreach (array_unique([$oldEmail, $newEmail]) as $recipient) {
                if (! UvhMail::emailChanged($recipient)) {
                    throw new MailAdmissionException('Email changed notices outbox admission failed');
                }
            }

            Audit::write($user->id, 'auth.email_change_confirmed', 'user', $user->id, [
                'revoked_all_sessions' => true,
            ]);

            return [
                'status' => 'ok',
                'user_id' => (int) $user->id,
            ];
        });
    }
}
