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
        'state_before_delete',
        'password_hash',
        'password_version',
        'version',
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
            'password_version' => 'integer',
            'version' => 'integer',
            'single_use' => 'boolean',
            'used_at' => 'datetime',
            'scheduled_at' => 'datetime',
            'expires_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function workspace(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function creator(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function domain(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(CustomDomain::class, 'domain_id');
    }

    public function tags(): \Illuminate\Database\Eloquent\Relations\BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'link_tags', 'link_id', 'tag_id');
    }

    public function rules(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(RedirectRule::class);
    }

    public function clickEvents(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(ClickEvent::class);
    }
}
