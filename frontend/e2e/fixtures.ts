import { test as base } from "@playwright/test";

import { resetSpentCounters } from "./support/limits";

export { expect } from "@playwright/test";
export type { APIRequestContext, APIResponse, Locator, Page, Response } from "@playwright/test";

/**
 * `test`, with the run's spent counters emptied before every case.
 *
 * Every spec imports `test` from here rather than from `@playwright/test`, so
 * that a case starts from the state a case is supposed to start from instead of
 * from whatever the previous one spent. Without it the suite is only green in
 * pieces: the last specs of a full run are refused for traffic that belongs to
 * earlier ones. See `support/limits.ts` for why the counters, and only the
 * counters, are the thing being cleared.
 */
export const test = base.extend<{ clearedCounters: void }>({
  clearedCounters: [
    async ({}, use) => {
      await resetSpentCounters();
      await use();
    },
    { auto: true },
  ],
});
