<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Larastan types datetime columns from the database schema as `string` and
 * ignores the `datetime` cast, so attributes used as dates are declared here.
 *
 * @property Carbon $expires_at
 * @property Carbon|null $used_at
 */
class EmailToken extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    const UPDATED_AT = null;

    protected $fillable = ['id', 'user_id', 'pending_registration_id', 'kind', 'expires_at', 'used_at'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime', 'created_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Un bearer `verify` nombra un registro pendiente —o, en el camino
     * heredado de activación, una fila de usuario sin verificar—; los demás
     * kinds nombran un usuario. La base impone exactamente uno de los dos
     * (`email_tokens_owner_check`).
     *
     * @return BelongsTo<PendingRegistration, $this>
     */
    public function pendingRegistration(): BelongsTo
    {
        return $this->belongsTo(PendingRegistration::class, 'pending_registration_id');
    }
}
