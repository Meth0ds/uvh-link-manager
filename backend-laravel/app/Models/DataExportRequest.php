<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DataExportRequest extends Model
{
    protected $fillable = [
        'user_id',
        'security_version',
        'status',
        'confirmation_token_hash',
        'confirmation_expires_at',
        'download_token_hash',
        'download_expires_at',
        'artifact_path',
        'confirmed_at',
        'ready_at',
        'download_served_at',
        'downloaded_at',
    ];

    protected $hidden = ['confirmation_token_hash', 'download_token_hash', 'artifact_path'];

    protected function casts(): array
    {
        return [
            'security_version' => 'integer',
            'confirmation_expires_at' => 'datetime',
            'download_expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'ready_at' => 'datetime',
            'download_served_at' => 'datetime',
            'downloaded_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
