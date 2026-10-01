<?php

namespace App\Support;

use App\Models\AccountDeletionRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Protective cancellation commits even when the general audit outbox is unavailable. */
final class AccountDeletionAudit
{
    /** Caller holds the account/request locks in its business transaction. */
    public static function admit(AccountDeletionRequest $request): bool
    {
        if (! $request->cancellation_audit_pending) {
            return true;
        }
        if ($request->status !== 'cancelled' || ! $request->cancelled_at) {
            return false;
        }
        try {
            // A savepoint contains a SQL failure without poisoning cancellation.
            DB::transaction(static function () use ($request): void {
                Audit::write($request->user_id, 'account.deletion_cancelled', 'account_deletion', $request->id, [
                    'cancelled_at' => $request->cancelled_at->toIso8601String(),
                ]);
                $request->update(['cancellation_audit_pending' => false]);
            });

            return true;
        } catch (Throwable $error) {
            Log::warning('Protective cancellation audit remains pending', ['request_id' => $request->id, 'exception_class' => $error::class]);

            return false;
        }
    }

    /** Bounded, serialized recovery; clearing the marker and admitting the event share a commit. */
    public static function reconcile(): void
    {
        $candidates = AccountDeletionRequest::where('cancellation_audit_pending', true)
            ->where('status', 'cancelled')->orderBy('id')->limit(100)->get(['id', 'user_id']);
        foreach ($candidates as $candidate) {
            $admitted = DB::transaction(static function () use ($candidate): bool {
                User::where('id', $candidate->user_id)->lockForUpdate()->first();
                $request = AccountDeletionRequest::where('id', $candidate->id)
                    ->where('cancellation_audit_pending', true)->where('status', 'cancelled')->lockForUpdate()->first();

                return ! $request || self::admit($request);
            });
            if (! $admitted) {
                throw new \RuntimeException('Protective cancellation audit admission unavailable');
            }
        }
    }
}
