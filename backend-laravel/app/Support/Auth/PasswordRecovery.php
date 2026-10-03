<?php

namespace App\Support\Auth;

use App\Models\EmailToken;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;

/** Password recovery authority, mail admission and revocation share their commit. */
final class PasswordRecovery
{
    /** The public lookup is only a hint; eligibility is rechecked under the account lock. */
    public static function request(User $owner, string $email): void
    {
        DB::transaction(function () use ($owner, $email): void {
            $locked = User::where('id', $owner->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked || ! $locked->email_verified_at || strtolower($locked->email) !== strtolower($email)) {
                return;
            }
            $last = EmailToken::where('user_id', $locked->id)
                ->where('kind', 'reset')->latest('created_at')->first();
            if ($last && $last->created_at->gt(now()->subSeconds(60))) {
                return;
            }
            $newToken = Ids::randomToken(32);
            $newTokenHash = Ids::sha256Hex($newToken);
            EmailToken::create([
                'id' => $newTokenHash,
                'user_id' => $locked->id,
                'kind' => 'reset',
                'expires_at' => now()->addHour(),
            ]);
            if (! UvhMail::resetPassword(
                $locked->email,
                FrontendUrl::base().'/auth/reset-password#token='.rawurlencode($newToken),
                $newTokenHash,
            )) {
                throw new MailAdmissionException('Password reset outbox admission failed');
            }
            EmailToken::where('user_id', $locked->id)->where('kind', 'reset')
                ->whereNull('used_at')->where('id', '!=', $newTokenHash)->delete();
        });
    }

    /**
     * Lock account before bearer; never issue a session from mailbox possession.
     * The caller validates syntax and hashes the new password outside the lock.
     *
     * @return int|null A positive affected user ID, -1 for weak live-identity password, or null for invalid authority.
     */
    public static function reset(EmailToken $snapshot, string $tokenHash, string $passwordHash, string $password): ?int
    {
        return DB::transaction(function () use ($snapshot, $tokenHash, $passwordHash, $password): ?int {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = EmailToken::where('id', $tokenHash)
                ->where('user_id', $snapshot->user_id)
                ->where('kind', 'reset')
                ->whereNull('used_at')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->used_at || $row->expires_at->lte(now())) {
                return null;
            }

            if (! $user || $user->deleted_at || ! $user->email_verified_at) {
                return null;
            }
            if (! PasswordStrength::isAcceptable($password, $user->name, $user->email)) {
                // Re-evaluate with the live account identity while its row is
                // locked. A reset must not accept a password derived from the
                // user's name or mailbox merely because the anonymous
                // preflight could not know that context.
                return -1;
            }

            $now = now();
            $row->update(['used_at' => $now]);
            EmailToken::where('user_id', $user->id)->where('kind', 'reset')->whereNull('used_at')->delete();
            $user->update([
                'password_hash' => $passwordHash,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);
            SecurityIncidentNotice::passwordChanged($user);
            Audit::write($user->id, 'auth.password_reset', 'user', $user->id);

            return (int) $user->id;
        });
    }
}
