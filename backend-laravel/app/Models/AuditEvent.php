<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditEvent extends Model
{
    const UPDATED_AT = null;

    protected $fillable = ['user_id', 'action', 'resource_type', 'resource_id', 'metadata', 'ip_hash'];

    protected function casts(): array
    {
        return ['metadata' => 'array', 'created_at' => 'datetime'];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
