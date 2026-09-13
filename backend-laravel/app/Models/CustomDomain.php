<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon|null $verified_at
 * @property Carbon|null $ownership_verified_at
 * @property Carbon|null $routing_verified_at
 * @property Carbon|null $dns_check_started_at
 * @property Carbon|null $dns_check_completed_at
 * @property Carbon|null $dns_first_failed_at
 * @property Carbon|null $tls_ready_at
 */
class CustomDomain extends Model
{
    protected $fillable = [
        'workspace_id',
        'domain',
        'verification_token',
        'verification_version',
        'state',
        'verified_at',
        'ownership_verified_at',
        'routing_verified_at',
        'dns_check_started_at',
        'dns_check_completed_at',
        'dns_error',
        'dns_failure_count',
        'dns_first_failed_at',
        'edge_eligible',
        'tls_version',
        'tls_ready_at',
        'tls_error',
    ];

    protected function casts(): array
    {
        return [
            'verification_version' => 'integer',
            'verified_at' => 'datetime',
            'ownership_verified_at' => 'datetime',
            'routing_verified_at' => 'datetime',
            'dns_check_started_at' => 'datetime',
            'dns_check_completed_at' => 'datetime',
            'dns_failure_count' => 'integer',
            'dns_first_failed_at' => 'datetime',
            'edge_eligible' => 'boolean',
            'tls_version' => 'integer',
            'tls_ready_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Workspace, $this> */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /** @return HasMany<Link, $this> */
    public function links(): HasMany
    {
        return $this->hasMany(Link::class, 'domain_id');
    }
}
