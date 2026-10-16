<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon|null $used_at
 * @property Carbon|null $scheduled_at
 * @property Carbon|null $expires_at
 * @property array<string, mixed>|null $app_opening
 * @property array<string, mixed>|null $social_preview
 * @property array<string, mixed>|null $expired_page
 * @property Carbon|null $deleted_at
 */
class Link extends Model
{
    use SoftDeletes;

    protected $dateFormat = 'Y-m-d H:i:s.uP';

    protected $fillable = [
        'workspace_id',
        'created_by',
        'domain_id',
        'collection_id',
        'alias',
        'name',
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
        'app_opening',
        'social_preview',
        'social_public_id',
        'expired_page',
        'expiry_notice_generation',
        'limit_notice_generation',
    ];

    protected $hidden = ['password_hash'];

    protected function casts(): array
    {
        return [
            'app_opening' => 'array',
            'social_preview' => 'array',
            'expired_page' => 'array',
            'expiry_notice_generation' => 'integer',
            'limit_notice_generation' => 'integer',
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

    /** @return BelongsTo<Workspace, $this> */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return BelongsTo<CustomDomain, $this> */
    public function domain(): BelongsTo
    {
        return $this->belongsTo(CustomDomain::class, 'domain_id');
    }

    /** @return BelongsToMany<Tag, $this> */
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'link_tags', 'link_id', 'tag_id');
    }

    /** @return BelongsTo<Collection, $this> */
    public function collection(): BelongsTo
    {
        return $this->belongsTo(Collection::class);
    }

    /** @return HasMany<RedirectRule, $this> */
    public function rules(): HasMany
    {
        return $this->hasMany(RedirectRule::class);
    }

    /** @return HasMany<LinkVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(LinkVersion::class);
    }
}
