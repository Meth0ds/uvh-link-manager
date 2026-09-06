<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UvhSession extends Model
{
    protected $table = 'sessions';

    public $incrementing = false;

    protected $keyType = 'string';

    const CREATED_AT = 'created_at';

    const UPDATED_AT = null;

    protected $fillable = [
        'id',
        'user_id',
        'user_agent',
        'ip_hash',
        'security_version',
        'mfa_verified_at',
        'last_used_at',
        'expires_at',
        'revoked_at',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'last_used_at' => 'datetime',
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
            'mfa_verified_at' => 'datetime',
            'security_version' => 'integer',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
