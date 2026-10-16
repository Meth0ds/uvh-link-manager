<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** @property bool $enabled */
final class AppLinkProfile extends Model
{
    protected function casts(): array
    {
        return ['enabled' => 'boolean', 'version' => 'integer'];
    }
}
