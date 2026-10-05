<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Immutable receipts keep automatic protective decisions auditable. */
final class AccountDeletionLifecycleAudit
{
    /** Caller holds the account and deletion-request locks in the mutation TX. */
    public static function record(?User $lockedUser, \stdClass $lockedRequest, string $action): bool
    {
        if (DB::transactionLevel() < 1
            || (int) $lockedRequest->id < 1
            || ($lockedUser !== null && (int) $lockedUser->id !== (int) $lockedRequest->user_id)
            || ! in_array($action, ['account.deletion_blocked', 'account.deletion_cancelled_mail_unconfirmed'], true)) {
            throw new \LogicException('Invalid protective deletion audit context');
        }
        $receipt = [
            'user_id' => $lockedUser?->id,
            'request_id' => (int) $lockedRequest->id,
            'affected_request_id' => (int) $lockedRequest->id,
            'action' => $action,
            'lifecycle_at' => IsoDate::format(now()),
        ];
        $receipt['id'] = DB::table('account_deletion_lifecycle_audits')->insertGetId($receipt);

        return self::admit((object) $receipt);
    }

    /** User before receipt; admission and receipt consumption share a savepoint. */
    public static function reconcile(): void
    {
        $candidates = DB::table('account_deletion_lifecycle_audits')->orderBy('id')->limit(100)->get(['id', 'user_id']);
        foreach ($candidates as $candidate) {
            $admitted = DB::transaction(static function () use ($candidate): bool {
                if ($candidate->user_id !== null) {
                    User::where('id', $candidate->user_id)->lockForUpdate()->first();
                }
                $receipt = DB::table('account_deletion_lifecycle_audits')->where('id', $candidate->id)->lockForUpdate()->first();

                return $receipt === null || self::admit($receipt);
            });
            if (! $admitted) {
                throw new \RuntimeException('Protective deletion lifecycle audit admission unavailable');
            }
        }
        if (DB::table('account_deletion_lifecycle_audits')->exists()) {
            throw new \RuntimeException('Protective deletion lifecycle audit recovery remains pending after bounded pass');
        }
    }

    private static function admit(\stdClass $receipt): bool
    {
        try {
            DB::transaction(static function () use ($receipt): void {
                Audit::write(
                    $receipt->user_id === null ? null : (int) $receipt->user_id,
                    (string) $receipt->action,
                    'account_deletion',
                    (int) $receipt->affected_request_id,
                    ['lifecycle_at' => IsoDate::format($receipt->lifecycle_at)],
                );
                if (DB::table('account_deletion_lifecycle_audits')->where('id', $receipt->id)->delete() !== 1) {
                    throw new \RuntimeException('Protective deletion audit receipt was not consumed');
                }
            });

            return true;
        } catch (\Throwable $error) {
            self::reportFailure((int) $receipt->id, $error);

            return false;
        }
    }

    private static function reportFailure(int $receiptId, \Throwable $error): void
    {
        try {
            Log::warning('Protective deletion lifecycle audit remains pending', [
                'receipt_id' => $receiptId, 'exception_class' => $error::class,
            ]);
        } catch (\Throwable) {
            // Diagnostics cannot roll back protection or its durable receipt.
        }
    }
}
