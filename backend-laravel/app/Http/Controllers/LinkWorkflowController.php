<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

final class LinkWorkflowController
{
    public function show(): JsonResponse
    {
        return response()->json([
            'enabled' => (bool) config('workflows.enabled', false),
            'reminderHours' => max(1, min(168, (int) config('workflows.reminder_hours', 24))),
            'reminderClickRatio' => max(0.01, min(0.99, (float) config('workflows.reminder_click_ratio', 0.9))),
            'maxSavedFilters' => max(1, min(50, (int) config('workflows.max_saved_filters', 50))),
        ]);
    }
}
