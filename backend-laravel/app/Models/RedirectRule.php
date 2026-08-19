<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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

    public function link()
    {
        return $this->belongsTo(Link::class);
    }
}
