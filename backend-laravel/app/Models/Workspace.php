<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Workspace extends Model
{
    protected $fillable = ['name', 'slug', 'owner_user_id'];

    public function owner()
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function memberships()
    {
        return $this->hasMany(Membership::class);
    }

    public function links()
    {
        return $this->hasMany(Link::class);
    }

    public function customDomains()
    {
        return $this->hasMany(CustomDomain::class);
    }

    public function quota()
    {
        return $this->hasOne(Quota::class);
    }

    public function apiTokens()
    {
        return $this->hasMany(ApiToken::class);
    }

    public function webhooks()
    {
        return $this->hasMany(Webhook::class);
    }
}
