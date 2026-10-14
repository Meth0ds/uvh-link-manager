<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        // Cleanup must stay bounded as configuration history grows. Concurrent
        // indexes avoid blocking redirect writes on an existing installation.
        DB::statement("CREATE INDEX CONCURRENTLY links_social_asset_reference_index ON links ((social_preview->>'imageAssetId'))");
        DB::statement("CREATE INDEX CONCURRENTLY link_versions_social_asset_reference_index ON link_versions ((configuration->'socialPreview'->>'imageAssetId'))");
        DB::statement("CREATE INDEX CONCURRENTLY link_templates_social_asset_reference_index ON link_templates ((payload->'social_preview'->>'imageAssetId'))");
        DB::statement('CREATE INDEX CONCURRENTLY social_assets_cleanup_index ON social_preview_assets (updated_at, id)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS social_assets_cleanup_index');
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS link_templates_social_asset_reference_index');
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS link_versions_social_asset_reference_index');
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS links_social_asset_reference_index');
    }
};
