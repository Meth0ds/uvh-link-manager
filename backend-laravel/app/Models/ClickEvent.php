<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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

    public function link(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Link::class);
    }
}
