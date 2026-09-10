<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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

    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
