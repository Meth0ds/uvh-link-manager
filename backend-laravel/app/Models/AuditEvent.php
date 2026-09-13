<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditEvent extends Model
{
    const UPDATED_AT = null;

    protected $fillable = ['user_id', 'workspace_id', 'action', 'resource_type', 'resource_id', 'metadata', 'ip_hash'];

    protected function casts(): array
    {
        return ['workspace_id' => 'integer', 'metadata' => 'array', 'created_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
