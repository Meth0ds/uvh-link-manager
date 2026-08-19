<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Tag extends Model
{
    public $timestamps = false;

    protected $fillable = ['workspace_id', 'name'];

    public function workspace()
    {
        return $this->belongsTo(Workspace::class);
    }

    public function links()
    {
        return $this->belongsToMany(Link::class, 'link_tags', 'tag_id', 'link_id');
    }
}
