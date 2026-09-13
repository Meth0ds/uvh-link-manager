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
 * @property Carbon|null $completion_expires_at
 * @property Carbon $expires_at
 * @property Carbon|null $email_confirmed_at
 * @property Carbon|null $approved_at
 * @property Carbon|null $rejected_at
 * @property Carbon|null $completed_at
 */
class AccountRecoveryRequest extends Model
{
    protected $fillable = [
        'user_id',
        'security_version',
        'status',
        'confirmation_token_hash',
        'confirmation_expires_at',
        'completion_token_hash',
        'completion_expires_at',
        'email_confirmed_at',
        'approved_at',
        'rejected_at',
        'completed_at',
        'expires_at',
    ];

    protected $hidden = ['confirmation_token_hash', 'completion_token_hash'];

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'confirmation_expires_at' => 'datetime',
            'completion_expires_at' => 'datetime',
            'email_confirmed_at' => 'datetime',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'completed_at' => 'datetime',
            'expires_at' => 'datetime',
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
