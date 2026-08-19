<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomDomain extends Model
{
    protected $fillable = ['workspace_id', 'domain', 'verification_token', 'state', 'verified_at'];

    protected function casts(): array
    {
        return ['verified_at' => 'datetime'];
    }

    public function workspace()
    {
        return $this->belongsTo(Workspace::class);
    }

    public function links()
    {
        return $this->hasMany(Link::class, 'domain_id');
    }
}
