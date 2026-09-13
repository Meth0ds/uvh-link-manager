<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Larastan types JSON and datetime columns from the database schema as `string`
 * and ignores the model casts, so the decoded payload and the date attributes
 * used as dates are declared here.
 *
 * @property array<string, mixed> $payload
 * @property Carbon|null $next_attempt_at
 * @property Carbon|null $locked_at
 * @property Carbon|null $delivered_at
 */
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

    /** @return BelongsTo<Webhook, $this> */
    /** @return BelongsTo<Webhook, $this> */
    public function webhook(): BelongsTo
    {
        return $this->belongsTo(Webhook::class);
    }
}
