<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

class LinkTag extends Pivot
{
    public $incrementing = false;

    protected $table = 'link_tags';

    protected $fillable = ['link_id', 'tag_id'];
}
