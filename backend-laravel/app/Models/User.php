<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory;

    protected $fillable = [
        'email',
        'name',
        'password_hash',
        'email_verified_at',
        'is_admin',
        'mfa_enabled',
        'mfa_secret',
        'mfa_pending_secret',
        'mfa_pending_expires_at',
        'recovery_codes',
        'security_version',
        'deleted_at',
    ];

    protected $hidden = ['password_hash', 'mfa_secret', 'mfa_pending_secret', 'recovery_codes'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'is_admin' => 'boolean',
            'mfa_enabled' => 'boolean',
            'mfa_pending_expires_at' => 'datetime',
            'recovery_codes' => 'array',
            'security_version' => 'integer',
            'deleted_at' => 'datetime',
        ];
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function sessions(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(UvhSession::class);
    }

    public function emailChangeRequest(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(EmailChangeRequest::class);
    }

    public function memberships(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(Membership::class);
    }

    public function ownedWorkspaces(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(Workspace::class, 'owner_user_id');
    }

    public function apiTokens(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(ApiToken::class, 'created_by');
    }

    public function auditEvents(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(AuditEvent::class);
    }
}
