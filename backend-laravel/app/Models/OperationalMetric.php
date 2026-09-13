<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Counter bucket fed by the operational metrics service.
 *
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so the bucket instant is declared here.
 *
 * There is no relation: a bucket is an aggregate identified only by its metric
 * name and instant.
 *
 * @property Carbon $bucket_at
 */
class OperationalMetric extends Model
{
    public $timestamps = false;

    protected $fillable = ['metric', 'bucket_at', 'count'];

    protected function casts(): array
    {
        return [
            'count' => 'integer',
            'bucket_at' => 'datetime',
        ];
    }
}
