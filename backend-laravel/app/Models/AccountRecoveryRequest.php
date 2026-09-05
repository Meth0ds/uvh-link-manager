<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
