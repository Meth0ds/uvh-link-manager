<?php

use App\Support\LocalRecoveryGate;
use App\Support\SocialAssetCleanup;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Console Routes
|--------------------------------------------------------------------------
|
| Scheduled jobs run via `php artisan schedule:work` (local) or the system
| cron that calls `php artisan schedule:run` every minute (production).
|
*/

Schedule::command('uvh:housekeeping')->everyMinute()->withoutOverlapping()->when(fn () => ! LocalRecoveryGate::paused());
// El resumen diario de notificaciones: un correo por cuenta con lo que su
// autor eligió acumular. Sin solape: una pasada larga no debe montarse sobre
// la siguiente.
Schedule::command('uvh:notifications-digest')->dailyAt('08:00')->withoutOverlapping()->when(fn () => ! LocalRecoveryGate::paused());

Schedule::command('uvh:destination-inspections-prune')->everyFiveMinutes()->withoutOverlapping()->when(fn () => ! LocalRecoveryGate::paused());

Schedule::call(fn () => SocialAssetCleanup::run())->name('social-assets-prune')->hourly()->withoutOverlapping()->when(fn () => ! LocalRecoveryGate::paused());

Schedule::call(fn () => DB::table('app_link_admissions')->where('expires_at', '<', now())->delete())->name('app-admissions-prune')->everyFiveMinutes()->withoutOverlapping()->when(fn () => ! LocalRecoveryGate::paused());

// A real scheduler can prove liveness while business tasks remain paused.
Schedule::call(fn () => Cache::put('uvh:health:scheduler', time(), now()->addMinutes(10)))
    ->name('local-recovery-heartbeat')->everyMinute()->evenInMaintenanceMode()
    ->when(fn () => config('recovery.enabled') && ! app()->environment('production'));
