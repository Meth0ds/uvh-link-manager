<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so the occurrence instant is declared here.
 *
 * @property Carbon $occurred_at
 */
class ClickEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'event_id',
        'link_id',
        'occurred_at',
        'country',
        'device',
        'browser',
        'os',
        'referrer_domain',
        'campaign',
        'visitor_hash',
        'password_ok',
    ];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime', 'password_ok' => 'boolean'];
    }

    /** @return BelongsTo<Link, $this> */
    public function link(): BelongsTo
    {
        return $this->belongsTo(Link::class);
    }
}
