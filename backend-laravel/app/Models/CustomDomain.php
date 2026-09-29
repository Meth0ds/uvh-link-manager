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
 * @property Carbon|null $tls_checked_at
 * @property Carbon|null $tls_probe_started_at
 * @property Carbon|null $tls_probe_completed_at
 * @property Carbon|null $tls_not_after
 * @property Carbon|null $tls_last_attempt_at
 * @property Carbon|null $tls_next_retry_at
 * @property Carbon|null $dns_observed_at
 * @property array<array{tag: string, value: string}>|null $caa_records
 * @property list<string>|null $routing_observed_addresses
 */
class CustomDomain extends Model
{
    protected $fillable = [
        'workspace_id',
        'domain',
        'verification_token',
        'verification_version',
        'verification_scheme',
        'desired_state',
        'ownership_status',
        'routing_status',
        'tls_status',
        'verified_at',
        'ownership_verified_at',
        'routing_verified_at',
        'dns_check_started_at',
        'dns_check_completed_at',
        'dns_error',
        'dns_failure_count',
        'dns_first_failed_at',
        'reputation_checked_at',
        'edge_eligible',
        'tls_version',
        'tls_ready_at',
        'tls_error',
        'tls_checked_at',
        'tls_not_after',
        'tls_issuer',
        'tls_last_attempt_at',
        'tls_next_retry_at',
        'root_destination',
        'not_found_mode',
        'is_default',
        'dns_observed_at',
        'ownership_txt_present',
        'routing_observed_target',
        'routing_observed_ttl',
        'routing_observed_addresses',
        'routing_observed_proxied',
        'caa_records',
        'caa_allows_issuer',
        'tls_probe_failures',
        'tls_probe_version',
        'tls_probe_started_at',
        'tls_probe_completed_at',
    ];

    protected function casts(): array
    {
        return [
            'verification_version' => 'integer',
            'verification_scheme' => 'integer',
            'verified_at' => 'datetime',
            'ownership_verified_at' => 'datetime',
            'routing_verified_at' => 'datetime',
            'dns_check_started_at' => 'datetime',
            'dns_check_completed_at' => 'datetime',
            'dns_failure_count' => 'integer',
            'dns_first_failed_at' => 'datetime',
            'reputation_checked_at' => 'datetime',
            'edge_eligible' => 'boolean',
            'tls_version' => 'integer',
            'tls_ready_at' => 'datetime',
            'tls_checked_at' => 'datetime',
            'tls_not_after' => 'datetime',
            'tls_last_attempt_at' => 'datetime',
            'tls_next_retry_at' => 'datetime',
            'dns_observed_at' => 'datetime',
            'ownership_txt_present' => 'boolean',
            'routing_observed_ttl' => 'integer',
            'routing_observed_addresses' => 'array',
            'routing_observed_proxied' => 'boolean',
            'caa_records' => 'array',
            'caa_allows_issuer' => 'boolean',
            'tls_probe_failures' => 'integer',
            'tls_probe_version' => 'integer',
            'tls_probe_started_at' => 'datetime',
            'tls_probe_completed_at' => 'datetime',
            'is_default' => 'boolean',
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
