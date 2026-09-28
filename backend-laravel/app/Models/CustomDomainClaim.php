<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The platform-wide ownership of a hostname.
 *
 * A `custom_domains` row is only a workspace's *request* to use a hostname;
 * this row is the claim that makes the hostname exclusive. It is created in the
 * same transaction that confirms the TXT challenge, so reserving a name nobody
 * can prove they own is impossible, and a request that never proved anything
 * holds nothing back from its true owner.
 *
 * @property Carbon $claimed_at
 * @property Carbon $last_proven_at
 */
class CustomDomainClaim extends Model
{
    public $timestamps = false;

    protected $table = 'custom_domain_claims';

    protected $fillable = [
        'workspace_id',
        'domain',
        'claimed_at',
        'last_proven_at',
    ];

    protected function casts(): array
    {
        return [
            'claimed_at' => 'datetime',
            'last_proven_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Workspace, $this> */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }
}
