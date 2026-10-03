<?php

namespace App\Support\Auth;

use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;

/** Mailbox owner lock, resend cooldown, new bearer and outbox share one commit. */
final class VerificationResend
{
    /**
     * The caller selects the pending or unverified legacy owner. This snapshot
     * never authorizes issuance: current eligibility and cooldown are checked
     * under lock. HTTP, CAPTCHA and the uniform public time floor stay outside.
     */
    public static function admit(PendingRegistration|User $owner): void
    {
        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        DB::transaction(function () use ($owner, $token, $tokenHash): void {
            // Eligibility differs, but cooldown, bearer replacement and mail
            // admission share the same algorithm after locking the owner.
            if ($owner instanceof User) {
                $locked = User::where('id', $owner->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $ownerColumn = 'user_id';
            } else {
                $locked = PendingRegistration::where('id', $owner->id)->lockForUpdate()->first();
                $ownerColumn = 'pending_registration_id';
            }
            if (! $locked || ($locked instanceof User && $locked->email_verified_at)) {
                // Consumed, verified or deleted after the public lookup: no
                // issuance, exactly like an unknown address on the public path.
                return;
            }
            $last = EmailToken::where($ownerColumn, $locked->id)
                ->where('kind', 'verify')->latest('created_at')->first();
            if ($last && $last->created_at->gt(now()->subSeconds(60))) {
                return;
            }

            EmailToken::create([
                'id' => $tokenHash,
                $ownerColumn => (int) $locked->id,
                'kind' => 'verify',
                'expires_at' => now()->addDay(),
            ]);
            if (! UvhMail::verification(
                $locked->email,
                FrontendUrl::base().'/auth/verify-email#token='.rawurlencode($token),
                $tokenHash,
            )) {
                throw new MailAdmissionException('Verification resend outbox admission failed');
            }
            EmailToken::where($ownerColumn, $locked->id)->where('kind', 'verify')
                ->whereNull('used_at')->where('id', '!=', $tokenHash)->delete();
        });
    }
}
