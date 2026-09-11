<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebhookDelivery extends Model
{
    const UPDATED_AT = null;

    protected $fillable = [
        'webhook_id',
        'config_version',
        'event',
        'event_id',
        'payload',
        'status',
        'attempts',
        'last_error',
        'next_attempt_at',
        'locked_at',
        'delivered_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'attempts' => 'integer',
            'config_version' => 'integer',
            'next_attempt_at' => 'datetime',
            'locked_at' => 'datetime',
            'delivered_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    /** @return \Illuminate\Database\Eloquent\Relations\BelongsTo<Webhook, $this> */
    public function webhook(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Webhook::class);
    }
}
