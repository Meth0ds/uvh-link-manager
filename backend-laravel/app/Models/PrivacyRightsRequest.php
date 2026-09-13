<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Data-subject request tracked against a statutory deadline.
 *
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon|null $identity_verified_at
 * @property Carbon|null $acknowledged_at
 * @property Carbon $due_at
 * @property Carbon|null $extended_until
 * @property Carbon|null $completed_at
 * @property Carbon|null $cancelled_at
 */
class PrivacyRightsRequest extends Model
{
    protected $fillable = [
        'user_id',
        'security_version',
        'type',
        'status',
        'generation_hash',
        'assigned_admin_id',
        'identity_verified_at',
        'acknowledged_at',
        'due_at',
        'extended_until',
        'extension_reason_code',
        'completed_at',
        'cancelled_at',
    ];

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'identity_verified_at' => 'datetime',
            'acknowledged_at' => 'datetime',
            'due_at' => 'datetime',
            'extended_until' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<User, $this> */
    public function assignedAdmin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_admin_id');
    }
}
