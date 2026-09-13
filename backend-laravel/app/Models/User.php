<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon|null $email_verified_at
 * @property Carbon|null $mfa_pending_expires_at
 * @property Carbon|null $deleted_at
 */
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

    /** @return HasMany<UvhSession, $this> */
    public function sessions(): HasMany
    {
        return $this->hasMany(UvhSession::class);
    }

    /** @return HasOne<EmailChangeRequest, $this> */
    public function emailChangeRequest(): HasOne
    {
        return $this->hasOne(EmailChangeRequest::class);
    }

    /** @return HasMany<Membership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /** @return HasMany<Workspace, $this> */
    public function ownedWorkspaces(): HasMany
    {
        return $this->hasMany(Workspace::class, 'owner_user_id');
    }

    /** @return HasMany<ApiToken, $this> */
    public function apiTokens(): HasMany
    {
        return $this->hasMany(ApiToken::class, 'created_by');
    }

    /** @return HasMany<AuditEvent, $this> */
    public function auditEvents(): HasMany
    {
        return $this->hasMany(AuditEvent::class);
    }

    /** @return HasMany<PrivacyRightsRequest, $this> */
    public function privacyRightsRequests(): HasMany
    {
        return $this->hasMany(PrivacyRightsRequest::class);
    }

    /** @return HasMany<PrivacyRightsRequest, $this> */
    public function assignedPrivacyRightsRequests(): HasMany
    {
        return $this->hasMany(PrivacyRightsRequest::class, 'assigned_admin_id');
    }

    /** @return HasMany<LegalAcceptance, $this> */
    public function legalAcceptances(): HasMany
    {
        return $this->hasMany(LegalAcceptance::class);
    }
}
