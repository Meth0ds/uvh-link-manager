<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

$email = 'roberto.dev@uvh.local';
$user = User::whereRaw('lower(email) = ?', [$email])->first();

if (! $user) {
    echo "MISSING USER - rerun creation\n";
    exit(1);
}

if (! $user->email_verified_at) {
    $user->forceFill(['email_verified_at' => now()])->save();
    echo "MARKED VERIFIED\n";
}

$acceptances = DB::table('legal_acceptances')->where('user_id', $user->id)->count();
echo "legal_acceptances={$acceptances}\n";
if ($acceptances === 0) {
    $acceptedAt = now();
    DB::table('legal_acceptances')->insert([
        ['user_id' => $user->id, 'document_type' => 'terms', 'version' => '2026-08-30', 'source' => 'registration', 'accepted_at' => $acceptedAt],
        ['user_id' => $user->id, 'document_type' => 'privacy_notice', 'version' => '2026-08-30', 'source' => 'registration', 'accepted_at' => $acceptedAt],
    ]);
    echo "ACCEPTANCES INSERTED\n";
}

$workspaces = $user->ownedWorkspaces()->get();
echo "owned_workspaces={$workspaces->count()}\n";
if ($workspaces->isEmpty()) {
    $workspace = $user->ownedWorkspaces()->create([
        'name' => 'Roberto Dev',
        'slug' => 'ws-'.strtolower(Str::random(8)),
    ]);
    $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
    $workspace->quota()->create(['links_limit' => 1000]);
    echo "WORKSPACE CREATED: {$workspace->slug}\n";
} else {
    foreach ($workspaces as $ws) {
        $membership = DB::table('workspace_members')->where('workspace_id', $ws->id)->where('user_id', $user->id)->count();
        $quota = DB::table('workspace_quotas')->where('workspace_id', $ws->id)->count();
        echo "workspace={$ws->slug} membership={$membership} quota={$quota}\n";
        if ($membership === 0) {
            $ws->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
            echo "  MEMBERSHIP ADDED\n";
        }
        if ($quota === 0) {
            $ws->quota()->create(['links_limit' => 1000]);
            echo "  QUOTA ADDED\n";
        }
    }
}

echo "OK: {$email} verified_at={$user->email_verified_at}\n";
