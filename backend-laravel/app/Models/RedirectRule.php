<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RedirectRule extends Model
{
    const UPDATED_AT = null;

    protected $fillable = [
        'link_id',
        'priority',
        'country',
        'language',
        'device',
        'os',
        'time_from',
        'time_to',
        'referrer',
        'campaign',
        'destination',
    ];

    protected function casts(): array
    {
        return ['priority' => 'integer', 'created_at' => 'datetime'];
    }

    /** @return BelongsTo<Link, $this> */
    public function link(): BelongsTo
    {
        return $this->belongsTo(Link::class);
    }
}
