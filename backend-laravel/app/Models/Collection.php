<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Agrupación plana de enlaces dentro de un workspace: un solo nivel, sin
 * subcolecciones. El nombre es único por workspace sin distinguir mayúsculas.
 */
class Collection extends Model
{
    public $timestamps = false;

    protected $fillable = ['workspace_id', 'name'];

    /** @return BelongsTo<Workspace, $this> */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /** @return HasMany<Link, $this> */
    public function links(): HasMany
    {
        return $this->hasMany(Link::class);
    }
}
