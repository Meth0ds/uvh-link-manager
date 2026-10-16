<?php

use App\Support\SocialAssetCleanup;
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

Schedule::command('uvh:housekeeping')->everyMinute()->withoutOverlapping();
// El resumen diario de notificaciones: un correo por cuenta con lo que su
// autor eligió acumular. Sin solape: una pasada larga no debe montarse sobre
// la siguiente.
Schedule::command('uvh:notifications-digest')->dailyAt('08:00')->withoutOverlapping();

Schedule::command('uvh:destination-inspections-prune')->everyFiveMinutes()->withoutOverlapping();

Schedule::call(fn () => SocialAssetCleanup::run())->name('social-assets-prune')->hourly()->withoutOverlapping();

Schedule::call(fn () => DB::table('app_link_admissions')->where('expires_at', '<', now())->delete())->name('app-admissions-prune')->everyFiveMinutes()->withoutOverlapping();
