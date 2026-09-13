<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Immutable evidence that a user accepted a legal document version.
 *
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so the acceptance instant is declared here.
 *
 * @property Carbon $accepted_at
 */
class LegalAcceptance extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'document_type',
        'version',
        'source',
        'accepted_at',
    ];

    protected function casts(): array
    {
        return ['accepted_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
