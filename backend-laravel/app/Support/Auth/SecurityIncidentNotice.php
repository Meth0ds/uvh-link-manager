<?php

namespace App\Support\Auth;

use App\Models\EmailToken;
use App\Models\User;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;

/** Admits a recoverable incident notice inside its caller's locked security mutation. */
final class SecurityIncidentNotice
{
    public static function passwordChanged(User $lockedUser): void
    {
        self::admit(
            $lockedUser,
            NotificationKinds::PASSWORD_CHANGED,
            static fn (string $to, string $incidentUrl, string $tokenHash): bool => UvhMail::passwordChanged($to, $incidentUrl, $tokenHash),
        );
    }

    /**
     * Cierre masivo de sesiones: el mismo portador de incidente que el cambio
     * de contraseña, con el aviso admitido en la transacción que cierra. Si el
     * cierre no cerró filas —ya estaban cerradas o no hay más sesiones— no hay
     * evento que anunciar y no se admite correo alguno.
     */
    public static function sessionsRevoked(User $lockedUser, bool $closedAll): void
    {
        self::admit(
            $lockedUser,
            $closedAll ? NotificationKinds::SESSIONS_REVOKED_ALL : NotificationKinds::SESSIONS_REVOKED_OTHERS,
            static fn (string $to, string $incidentUrl, string $tokenHash): bool => UvhMail::sessionsRevoked($to, $incidentUrl, $tokenHash, $closedAll),
        );
    }

    /**
     * Admit the incident bearer and encrypted notice in the mutation's commit.
     *
     * Callers must already hold the row locks that serialize the mutation. Do
     * not open a separate transaction or swallow admission failures here: a
     * crash must not commit the security change without a recoverable notice.
     * Provider delivery remains after-commit and is not a prerequisite for
     * changing credentials.
     *
     * @param  \Closure(string, string, string): bool  $deliver
     */
    private static function admit(User $lockedUser, string $notificationKind, \Closure $deliver): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Security notice requires the mutation transaction');
        }

        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        EmailToken::create([
            'id' => $tokenHash,
            'user_id' => $lockedUser->id,
            'kind' => 'security_revoke',
            'expires_at' => now()->addDay(),
        ]);
        $url = FrontendUrl::base().'/auth/security-incident#token='.rawurlencode($token);
        NotificationInbox::record((int) $lockedUser->id, $notificationKind);
        Audit::write((int) $lockedUser->id, 'auth.security_notice_admitted', 'user', $lockedUser->id, ['kind' => $notificationKind]);
        if (! $deliver($lockedUser->email, $url, $tokenHash)) {
            throw new MailAdmissionException('Security notice outbox admission failed');
        }

        // Retain this new bearer plus four previous notices. Excluding the new
        // ID avoids pruning it when timestamps tie and random hashes determine
        // the order; a just-admitted notice must not be obsolete at commit.
        $staleIds = EmailToken::where('user_id', $lockedUser->id)
            ->where('kind', 'security_revoke')
            ->whereNull('used_at')
            ->where('id', '!=', $tokenHash)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->offset(4)
            ->limit(100)
            ->pluck('id');
        if ($staleIds->isNotEmpty()) {
            EmailToken::whereIn('id', $staleIds)->delete();
        }
    }

    public static function sessionRevoked(User $lockedUser): void
    {
        self::admit($lockedUser, NotificationKinds::SESSION_REVOKED,
            static fn (string $to, string $url, string $hash): bool => UvhMail::sessionRevoked($to, $url, $hash));
    }
}
