<?php

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
