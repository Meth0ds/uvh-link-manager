<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebhookDelivery extends Model
{
    const UPDATED_AT = null;

    protected $fillable = [
        'webhook_id',
        'event',
        'event_id',
        'payload',
        'status',
        'attempts',
        'last_error',
        'next_attempt_at',
        'delivered_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'attempts' => 'integer',
            'next_attempt_at' => 'datetime',
            'delivered_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function webhook()
    {
        return $this->belongsTo(Webhook::class);
    }
}
