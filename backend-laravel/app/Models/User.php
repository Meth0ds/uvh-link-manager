<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    protected $fillable = [
        'email',
        'name',
        'password_hash',
        'email_verified_at',
        'is_admin',
        'mfa_enabled',
        'mfa_secret',
        'recovery_codes',
        'deleted_at',
    ];

    protected $hidden = ['password_hash', 'mfa_secret', 'recovery_codes'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'is_admin' => 'boolean',
            'mfa_enabled' => 'boolean',
            'recovery_codes' => 'array',
            'deleted_at' => 'datetime',
        ];
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function sessions()
    {
        return $this->hasMany(UvhSession::class);
    }

    public function memberships()
    {
        return $this->hasMany(Membership::class);
    }

    public function ownedWorkspaces()
    {
        return $this->hasMany(Workspace::class, 'owner_user_id');
    }

    public function apiTokens()
    {
        return $this->hasMany(ApiToken::class, 'created_by');
    }

    public function auditEvents()
    {
        return $this->hasMany(AuditEvent::class);
    }
}
