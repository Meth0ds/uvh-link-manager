<?php

namespace App\Support\Auth;

use App\Models\AuditEvent;
use App\Support\IsoDate;
use App\Support\MfaFreshness;
use App\Support\UvhRequest;
use Carbon\CarbonImmutable;

/** Bounded, minimized projections from a live account read context. */
final class AccountQueries
{
    /** @return array<string, mixed> */
    public static function me(AccountReadContext $context): array
    {
        $user = $context->user;

        return ['user' => UvhRequest::publicUser($user)];
    }

    /** @return array<string, mixed> */
    public static function mfaSession(AccountReadContext $context): array
    {
        $user = $context->user;
        $verifiedAt = $context->session->mfa_verified_at;
        $freshMinutes = MfaFreshness::windowMinutes();
        $fresh = (bool) $user->mfa_enabled
            && MfaFreshness::isFresh($verifiedAt);

        return [
            'enabled' => (bool) $user->mfa_enabled,
            'fresh' => $fresh,
            'verifiedAt' => IsoDate::format($verifiedAt),
            'expiresAt' => $verifiedAt
                ? IsoDate::format(CarbonImmutable::instance($verifiedAt)->addMinutes($freshMinutes))
                : null,
        ];
    }

    /** @return array<string, mixed> */
    public static function sessions(AccountReadContext $context): array
    {
        $user = $context->user;
        $currentId = $context->session->id;
        // Keep this device visible even when the historical list is bounded.
        // The extra row proves truncation without counting the whole history.
        $available = $user->sessions()
            ->orderByRaw('id = ? desc', [$currentId])
            ->orderByDesc('last_used_at')->orderByDesc('id')
            ->limit(101)->get();
        $rows = $available->take(100)->map(fn ($s) => [
            'id' => $s->id,
            'user_agent' => $s->user_agent,
            'created_at' => IsoDate::format($s->created_at),
            'last_used_at' => IsoDate::format($s->last_used_at),
            'expires_at' => IsoDate::format($s->expires_at),
            'revoked_at' => IsoDate::format($s->revoked_at),
            'mfa_verified_at' => IsoDate::format($s->mfa_verified_at),
            'current' => $s->id === $currentId,
        ]);

        return ['sessions' => $rows, 'truncated' => $available->count() > 100];
    }

    /** @return array<string, mixed> */
    public static function securityCenter(AccountReadContext $context): array
    {
        $user = $context->user;
        $activeSessions = $user->sessions()->whereNull('revoked_at')->where('expires_at', '>', now())->count();
        $publicUser = UvhRequest::publicUser($user);
        $passwordActions = ['auth.password_change', 'auth.password_reset', 'auth.account_recovery_completed'];
        $lastPasswordEvent = AuditEvent::where('user_id', $user->id)->whereIn('action', $passwordActions)
            ->orderByDesc('created_at')->orderByDesc('id')->first(['created_at']);
        $visibleActions = [
            'auth.login', 'auth.logout', 'auth.password_change', 'auth.password_reset',
            'auth.session_revoke', 'auth.sessions_revoked_others', 'auth.sessions_revoked_all',
            'auth.mfa_enable', 'auth.mfa_disable', 'auth.mfa_reconfigured',
            'auth.mfa_recovery', 'auth.mfa_recovery_regenerate', 'auth.mfa_reauthenticated',
            'auth.email_change_requested', 'auth.email_change_cancelled', 'auth.email_change_confirmed',
            'auth.emergency_access_revoked', 'auth.account_recovery_completed',
        ];
        $activityRows = AuditEvent::where('user_id', $user->id)->whereIn('action', $visibleActions)
            ->orderByDesc('created_at')->orderByDesc('id')->limit(21)->get(['id', 'action', 'created_at']);
        // One row past the bound is what tells a full panel from a truncated
        // one, so the last twenty events are never read as the whole personal
        // audit trail. Same contract as the per-link activity panel.
        $activityTruncated = $activityRows->count() > 20;
        $activity = $activityRows->take(20)->map(fn (AuditEvent $event) => [
            'id' => (int) $event->id,
            'action' => $event->action,
            'createdAt' => IsoDate::format($event->created_at),
        ]);

        return [
            'summary' => [
                'mfaEnabled' => (bool) $user->mfa_enabled,
                'recoveryCodesRemaining' => is_array($user->recovery_codes) ? count($user->recovery_codes) : 0,
                'activeSessions' => $activeSessions,
                'currentSessionMfaVerifiedAt' => IsoDate::format($context->session->mfa_verified_at),
                'pendingEmail' => $publicUser['pendingEmail'],
                'pendingEmailExpiresAt' => $publicUser['pendingEmailExpiresAt'],
                'lastPasswordEventAt' => IsoDate::format($lastPasswordEvent?->created_at),
            ],
            'activity' => $activity,
            'truncated' => $activityTruncated,
        ];
    }
}
