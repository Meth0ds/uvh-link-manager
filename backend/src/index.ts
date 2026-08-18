import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { defaultOptions, runHousekeeping } from "./housekeeping.js";

migrate();

const app = createApp();

// Bind to 0.0.0.0 so the managed preview can reach the API.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`[uvh-api] listening on 0.0.0.0:${config.port} (${config.env})`);
});

// ---------------- Scheduler (replaces Laravel cron; in-process) ----------------
// Options are parsed strictly once at boot: invalid values fail startup
// instead of being interpreted silently.
const housekeepingOptions = defaultOptions();

// Lightweight jobs every minute; heavy purge passes are throttled internally
// (HOUSEKEEPING_INTERVAL_MINUTES, default 60) and run in bounded batches.
const scheduler = setInterval(() => runHousekeeping(housekeepingOptions), 60_000);
runHousekeeping(housekeepingOptions);

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[uvh-api] received ${sig}, shutting down`);
    clearInterval(scheduler);
    process.exit(0);
  });
}
