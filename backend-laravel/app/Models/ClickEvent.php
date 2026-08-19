<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ClickEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
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

    public function link()
    {
        return $this->belongsTo(Link::class);
    }
}
