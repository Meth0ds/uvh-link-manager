<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A browser's registration context, independent of mailbox/account occupancy.
 * Both accepted and occupied signup destinations will receive their own row.
 * This context owns no account, password, workspace or legal acceptance.
 *
 * @property Carbon $expires_at
 * @property Carbon|null $legacy_consumed_at
 */
final class RegistrationAttempt extends Model
{
    protected $attributes = ['security_version' => 1];

    protected $fillable = [
        'email', 'security_version', 'expires_at', 'pending_registration_id',
        'pending_security_version', 'legacy_pending_id', 'legacy_security_version',
        'legacy_claim_hash', 'legacy_consumed_at',
    ];

    // The cookie deadline must round-trip the stored millisecond deadline.
    protected $dateFormat = 'Y-m-d H:i:s.uP';

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'pending_registration_id' => 'integer',
            'pending_security_version' => 'integer',
            'legacy_pending_id' => 'integer',
            'legacy_security_version' => 'integer',
            'expires_at' => 'datetime',
            'legacy_consumed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<PendingRegistration, $this> */
    public function pendingRegistration(): BelongsTo
    {
        return $this->belongsTo(PendingRegistration::class);
    }
}
