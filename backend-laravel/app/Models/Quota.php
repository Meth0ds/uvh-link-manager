<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Quota extends Model
{
    public $incrementing = false;

    protected $primaryKey = 'workspace_id';

    const CREATED_AT = null;

    protected $fillable = ['workspace_id', 'links_limit'];

    protected function casts(): array
    {
        return ['links_limit' => 'integer', 'updated_at' => 'datetime'];
    }

    public function workspace()
    {
        return $this->belongsTo(Workspace::class, 'workspace_id');
    }
}
