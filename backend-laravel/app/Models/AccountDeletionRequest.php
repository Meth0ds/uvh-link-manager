<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon|null $confirmation_expires_at
 * @property Carbon|null $execute_after
 * @property Carbon|null $confirmed_at
 * @property Carbon|null $cancelled_at
 * @property Carbon|null $executed_at
 */
class AccountDeletionRequest extends Model
{
    protected $fillable = [
        'user_id', 'security_version', 'status', 'confirmation_token_hash', 'cancel_token_hash',
        'confirmation_expires_at', 'execute_after', 'confirmed_at', 'cancelled_at', 'executed_at',
    ];

    protected $hidden = ['confirmation_token_hash', 'cancel_token_hash'];

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'confirmation_expires_at' => 'datetime',
            'execute_after' => 'datetime',
            'confirmed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'executed_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
