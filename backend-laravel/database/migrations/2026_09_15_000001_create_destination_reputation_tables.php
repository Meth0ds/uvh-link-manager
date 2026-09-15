<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Destinations the platform refuses to serve, independent of the link
        // that pointed at them. Blocking only the link left the abuse intact:
        // the same destination came back as a second link a minute later, and
        // the same URL could also be reached through a redirect rule.
        Schema::create('destination_denylist', function (Blueprint $table) {
            $table->bigIncrements('id');
            // `host` covers every URL on that host; `url` covers one exact
            // destination. Matching is by label, never by substring: a rule for
            // `evil.example` must not cover `notevil.example`.
            $table->string('match_kind', 8);
            $table->string('match_value', 255);
            $table->string('reason', 500);
            $table->string('source', 16);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            // A temporary block is still a block; expiry is explicit rather than
            // implied by the absence of a row.
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
        DB::statement("ALTER TABLE destination_denylist ADD CONSTRAINT destination_denylist_kind_check CHECK (match_kind IN ('host','url'))");
        DB::statement("ALTER TABLE destination_denylist ADD CONSTRAINT destination_denylist_source_check CHECK (source IN ('manual','provider','report'))");
        DB::statement('CREATE UNIQUE INDEX destination_denylist_match_unique ON destination_denylist (match_kind, match_value)');
        // Link creation looks up one host and one URL per destination; every
        // other query is a bounded operator listing.
        DB::statement('CREATE INDEX destination_denylist_value_index ON destination_denylist (match_value)');

        // Cached verdicts from whatever reputation provider is configured. The
        // row is the reason the provider is not called per click and not once
        // per link: it is called once per destination per TTL.
        Schema::create('destination_reputation_checks', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('url_hash', 64);
            $table->string('host', 255);
            $table->string('verdict', 16);
            $table->smallInteger('score')->nullable();
            $table->string('provider', 64);
            $table->timestamp('checked_at');
            $table->timestamp('expires_at')->nullable();
            // Consecutive provider failures. A stale verdict is a stale verdict
            // whether the provider answered "unknown" or did not answer at all.
            $table->unsignedInteger('failure_count')->default(0);
            $table->string('last_error', 200)->nullable();
            $table->timestamps();
        });
        DB::statement("ALTER TABLE destination_reputation_checks ADD CONSTRAINT destination_reputation_verdict_check CHECK (verdict IN ('unknown','safe','suspicious','malicious'))");
        DB::statement('CREATE UNIQUE INDEX destination_reputation_url_unique ON destination_reputation_checks (url_hash)');
        DB::statement('CREATE INDEX destination_reputation_recheck_index ON destination_reputation_checks (expires_at)');
        DB::statement('CREATE INDEX destination_reputation_host_index ON destination_reputation_checks (host)');

        // Automated signals share the moderation queue with public reports, so
        // provenance is a column instead of a naming convention. The partial
        // unique index on (link_id, reporter_hash, report_day) only covers rows
        // with a reporter, which is what lets a provider signal coexist with a
        // human report for the same link and day.
        Schema::table('abuse_reports', function (Blueprint $table) {
            $table->string('source', 16)->default('public');
        });
        DB::statement("ALTER TABLE abuse_reports ADD CONSTRAINT abuse_reports_source_check CHECK (source IN ('public','reputation'))");
        DB::statement('CREATE INDEX abuse_reports_source_index ON abuse_reports (source, status)');
        // One open automatic case per link, enforced here rather than only by a
        // read-then-write check: two reputation workers can evaluate the same
        // link at once, and a moderation queue must not accumulate duplicates.
        // Scoped to `reputation` so the public report flow keeps its own
        // per-reporter rule untouched.
        DB::statement("CREATE UNIQUE INDEX abuse_reports_open_reputation_unique ON abuse_reports (link_id) WHERE status = 'open' AND source = 'reputation'");

        // What the owner of a blocked link can say about it. `docs/security.md`
        // claimed an appeal path existed; until this table there was none, so a
        // false-positive moderation action was final.
        Schema::create('link_appeals', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('message', 2000)->nullable();
            $table->string('status', 16);
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->timestamps();
        });
        DB::statement("ALTER TABLE link_appeals ADD CONSTRAINT link_appeals_status_check CHECK (status IN ('open','upheld','restored'))");
        // One open appeal per link: the queue is a queue, not a mailbox.
        DB::statement("CREATE UNIQUE INDEX link_appeals_open_unique ON link_appeals (link_id) WHERE status = 'open'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS abuse_reports_open_reputation_unique');
        DB::statement('DROP INDEX IF EXISTS abuse_reports_source_index');
        DB::statement('ALTER TABLE abuse_reports DROP CONSTRAINT IF EXISTS abuse_reports_source_check');
        Schema::table('abuse_reports', function (Blueprint $table) {
            $table->dropColumn('source');
        });
        Schema::dropIfExists('link_appeals');
        Schema::dropIfExists('destination_reputation_checks');
        Schema::dropIfExists('destination_denylist');
    }
};
