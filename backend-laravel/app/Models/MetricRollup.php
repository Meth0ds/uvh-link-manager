<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MetricRollup extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'link_id',
        'day',
        'clicks',
        'visitors',
        'countries',
        'devices',
        'browsers',
        'os',
        'referrers',
        'campaigns',
    ];

    protected function casts(): array
    {
        return [
            'clicks' => 'integer',
            'visitors' => 'integer',
            'countries' => 'array',
            'devices' => 'array',
            'browsers' => 'array',
            'os' => 'array',
            'referrers' => 'array',
            'campaigns' => 'array',
        ];
    }

    public function link()
    {
        return $this->belongsTo(Link::class);
    }
}
