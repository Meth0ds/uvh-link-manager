<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditEvent extends Model
{
    const UPDATED_AT = null;

    protected $fillable = ['user_id', 'workspace_id', 'action', 'resource_type', 'resource_id', 'metadata', 'ip_hash'];

    protected function casts(): array
    {
        return ['workspace_id' => 'integer', 'metadata' => 'array', 'created_at' => 'datetime'];
    }

    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
