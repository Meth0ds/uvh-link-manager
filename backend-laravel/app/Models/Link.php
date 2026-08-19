<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Link extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'workspace_id',
        'created_by',
        'domain_id',
        'alias',
        'destination',
        'fallback_destination',
        'state',
        'password_hash',
        'max_clicks',
        'click_count',
        'single_use',
        'used_at',
        'scheduled_at',
        'expires_at',
        'notes',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'deleted_at',
    ];

    protected $hidden = ['password_hash'];

    protected function casts(): array
    {
        return [
            'max_clicks' => 'integer',
            'click_count' => 'integer',
            'single_use' => 'boolean',
            'used_at' => 'datetime',
            'scheduled_at' => 'datetime',
            'expires_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function workspace()
    {
        return $this->belongsTo(Workspace::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function domain()
    {
        return $this->belongsTo(CustomDomain::class, 'domain_id');
    }

    public function tags()
    {
        return $this->belongsToMany(Tag::class, 'link_tags', 'link_id', 'tag_id');
    }

    public function rules()
    {
        return $this->hasMany(RedirectRule::class);
    }

    public function clickEvents()
    {
        return $this->hasMany(ClickEvent::class);
    }
}
