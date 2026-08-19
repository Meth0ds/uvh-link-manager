<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AbuseReport extends Model
{
    const UPDATED_AT = null;

    protected $fillable = ['link_id', 'reporter_email', 'reason', 'details', 'status'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function link()
    {
        return $this->belongsTo(Link::class);
    }
}
