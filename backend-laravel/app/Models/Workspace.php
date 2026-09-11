<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Workspace extends Model
{
    protected $fillable = ['name', 'slug', 'owner_user_id'];

    public function owner(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function memberships(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(Membership::class);
    }

    public function links(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(Link::class);
    }

    public function customDomains(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(CustomDomain::class);
    }

    public function quota(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(Quota::class);
    }

    public function apiTokens(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(ApiToken::class);
    }

    public function webhooks(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(Webhook::class);
    }
}
