<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property string|null $stage
 * @property Carbon|null $download_expires_at
 * @property Carbon|null $ready_at
 * @property Carbon|null $download_served_at
 * @property Carbon|null $downloaded_at
 */
class DataExportRequest extends Model
{
    protected $fillable = [
        'user_id',
        'security_version',
        'status',
        'stage',
        'mail_generation_hash',
        'failure_reason',
        'download_expires_at',
        'artifact_path',
        'ready_at',
        'download_served_at',
        'downloaded_at',
    ];

    /**
     * `mail_generation_hash` is not a bearer: it identifies the generation a
     * queued "ready" notice describes, so the outbox can drop stale ones. The
     * artifact path is internal plumbing.
     */
    protected $hidden = ['mail_generation_hash', 'artifact_path'];

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'download_expires_at' => 'datetime',
            'ready_at' => 'datetime',
            'download_served_at' => 'datetime',
            'downloaded_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
