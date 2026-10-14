<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property array<string, mixed>|null $configuration
 * @property array<string, mixed>|null $changed_fields
 * @property Carbon|null $created_at
 */
class LinkVersion extends Model
{
    public $timestamps = false;

    protected $fillable = ['workspace_id', 'link_id', 'revision', 'link_version', 'actor_user_id', 'source', 'configuration', 'configuration_hash', 'changed_fields', 'created_at'];

    protected function casts(): array
    {
        return ['configuration' => 'array', 'changed_fields' => 'array', 'created_at' => 'datetime', 'revision' => 'integer', 'link_version' => 'integer'];
    }

    /** @return BelongsTo<Link, $this> */
    public function link(): BelongsTo
    {
        return $this->belongsTo(Link::class);
    }

    /** @return BelongsTo<User, $this> */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
