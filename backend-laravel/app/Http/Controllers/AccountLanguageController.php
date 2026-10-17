<?php

namespace App\Http\Controllers;

use App\Support\Language;
use App\Support\SecurityContext;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AccountLanguageController
{
    public function update(Request $request): JsonResponse
    {
        $language = $request->input('language');
        if (! Language::valid($language)) {
            return response()->json(['error' => __('messages.invalid_language'), 'code' => 'invalid_language'], 422);
        }
        $user = UvhRequest::user($request);
        $updated = DB::transaction(function () use ($user, $request, $language): bool {
            $context = SecurityContext::lock($user, UvhRequest::sessionId($request), true);
            if ($context === null) {
                return false;
            }
            $context->user->update(['language' => $language, 'updated_at' => now()]);

            return true;
        });

        return $updated
            ? response()->json(['language' => $language])
            : response()->json(['error' => __('messages.session_changed'), 'reason' => 'session_context_changed'], 409);
    }
}
