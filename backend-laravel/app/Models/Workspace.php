<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Workspace extends Model
{
    /**
     * `owner_user_id` is deliberately NOT mass-assignable. Moving ownership is
     * a guarded operation — `transferOwnership` demands owner role, step-up MFA
     * and a deterministic set of row locks — and a future
     * `Workspace::update($request->all())` must not be able to walk around all
     * of that by accident. The only two writers use `forceCreate`/`forceFill`.
     */
    protected $fillable = ['name', 'slug'];

    /** @return BelongsTo<User, $this> */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    /** @return HasMany<Membership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /** @return HasMany<Link, $this> */
    public function links(): HasMany
    {
        return $this->hasMany(Link::class);
    }

    /** @return HasOne<Quota, $this> */
    public function quota(): HasOne
    {
        return $this->hasOne(Quota::class);
    }

    /** @return HasMany<Webhook, $this> */
    public function webhooks(): HasMany
    {
        return $this->hasMany(Webhook::class);
    }
}
