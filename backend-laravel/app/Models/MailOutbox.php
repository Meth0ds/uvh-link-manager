<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Durable transactional mail outbox.
 *
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * There is deliberately no relation for `resource_type`/`resource_id`: callers
 * store loose references (`user`, `link`, `account_deletion`, ...) with no
 * morph map and no foreign key, so an Eloquent relation would promise a join
 * that the database cannot guarantee.
 *
 * @property Carbon $available_at
 * @property Carbon|null $queued_at
 * @property Carbon|null $locked_at
 * @property Carbon|null $sent_at
 * @property Carbon|null $failed_at
 * @property Carbon|null $last_manual_retry_at
 */
class MailOutbox extends Model
{
    protected $table = 'mail_outbox';

    protected $fillable = [
        'idempotency_key',
        'encrypted_envelope',
        'kind',
        'resource_type',
        'resource_id',
        'resource_generation',
        'status',
        'attempts',
        'manual_retry_count',
        'available_at',
        'queued_at',
        'locked_at',
        'lock_token',
        'sent_at',
        'failed_at',
        'last_manual_retry_at',
        'last_error',
    ];

    protected $hidden = ['encrypted_envelope', 'lock_token'];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'manual_retry_count' => 'integer',
            'available_at' => 'datetime',
            'queued_at' => 'datetime',
            'locked_at' => 'datetime',
            'sent_at' => 'datetime',
            'failed_at' => 'datetime',
            'last_manual_retry_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }
}
