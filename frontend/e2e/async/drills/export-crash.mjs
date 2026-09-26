/**
 * A maximum-size export against a worker that is killed in the middle.
 *
 * One scenario, self-contained: the automated path has to survive its process
 * dying between registering the artifact path and publishing the request, and
 * the abandoned request has to end terminal without leaving bytes behind.
 */

import { auditCount, housekeepingNow, startExport, whyStalled } from "./support.mjs";
import { check, sleep, until } from "../expect.mjs";
import { messageMatching, messagesFor, tokenFromUrl } from "../fixtures.mjs";
import { api, csrfToken, password } from "../session.mjs";
import { backend, docker, inspect } from "../topology.mjs";

/**
 * A maximum-size export against a worker that dies in the middle.
 *
 * The automated path has to survive the process being killed between the
 * moment it registers its artifact path and the moment it publishes the
 * request. What the gate asks for is that the export is not executed twice and
 * is not orphaned, across generation, publication, download and
 * acknowledgement; each of those is driven to its own boundary here.
 */
export async function exportCrashDrill({ email, session, workspaceId }) {
  // A large export through the real payload path —row hydration, decryption,
  // JSON encoding, chunked encryption, storage write— across thousands of
  // records, and never a toy one. The generation is streamed by blocks now, so
  // there is no small automated budget to fill: what the drill needs is a
  // document big enough that the kill lands inside generation and that the
  // chunked path is the one exercised.
  //
  // The row count is asked for and then fitted by the inspector: it encodes the
  // document with the job's own builder and trims the count if it would cross
  // the operational ceiling. Both the fitting target and every assertion below
  // read that ceiling from the layer that applies it (`cap_bytes`), so no
  // ceiling is restated here.
  const seeded = inspect("export-seed", `${email} 9500 1300`);
  const capBytes = seeded.cap_bytes ?? 0;
  const largeBytes = 8 * 1024 * 1024;
  check(
    "export crash: a large account export is seeded",
    seeded.messages > 0 && seeded.messages <= 10_000
      && seeded.json_bytes > largeBytes && seeded.json_bytes <= capBytes,
    JSON.stringify(seeded),
  );
  if (!seeded.messages) return;
  const messages = seeded.messages;

  // The private volume is shared with every other run and with the local stack,
  // so every artifact claim is made against this baseline set of names rather
  // than against an assumed empty directory.
  const cleanBefore = inspect("export-artifacts");
  const names = (files) => files.map((file) => file.name).sort().join(",");
  const added = (files) => files.filter((file) => !cleanBefore.some((base) => base.name === file.name));

  /**
   * Confirm an export with no consumer running, then SIGKILL the worker the
   * moment it starts running that job.
   *
   * Two deliberate choices time the kill:
   *
   *  * the worker is booted first and held frozen, so the seconds of framework
   *    boot are not part of the race — a cold start would put them between the
   *    confirmation and the job, where they mean nothing;
   *  * the kill is triggered by the worker's own log line rather than by a poll
   *    of the database, because reading durable state costs a full application
   *    boot, several times longer than the export itself, so a database-timed
   *    kill would always land after it had finished.
   */
  async function killWorkerInsideExport(label) {
    docker(["start", "queue-exports"]);
    await sleep(6_000);
    docker(["pause", "queue-exports"]);

    const request = await startExport(session, workspaceId);
    if (request.reason) {
      docker(["kill", "queue-exports"]);
      check(`export crash: ${label} is confirmed`, false, request.reason);
      return null;
    }
    const queued = inspect("export", String(request.id));
    check(`export crash: ${label} waits for its worker`, queued.status === "processing", JSON.stringify(queued));

    const runs = () => (docker(["logs", "queue-exports"], { capture: true }).match(/GenerateDataExportJob .*RUNNING/g) ?? []).length;
    const alreadyRun = runs();
    // Release the frozen worker: it is already booted, so the job starts within
    // its poll interval and the reaction below lands inside the export.
    docker(["unpause", "queue-exports"]);
    const reachedWorker = await until(`export crash: ${label} reaches the worker`, () => (runs() > alreadyRun ? true : undefined), {
      deadlineMs: 60_000,
      intervalMs: 100,
    }).catch((error) => {
      check(`export crash: ${label} reaches the worker`, false, error.message);
      return null;
    });
    docker(["kill", "queue-exports"]); // SIGKILL: no shutdown handler, no bookkeeping.
    if (reachedWorker === null) return null;

    return { id: request.id, reachedWorker: true, killed: inspect("export", String(request.id)), latest: inspect("export-latest") };
  }

  // --- route one: the broker re-delivers the job ---------------------------
  const readyMailBefore = inspect("mail-kind", "data_export_ready").length;
  const first = await killWorkerInsideExport("the interrupted export");
  if (!first) return;
  check("export crash: the worker died with the export in flight", first.killed.status === "processing", JSON.stringify(first.killed));
  check("export crash: the request row, not the process, is the durable anchor", first.killed.artifact !== null, JSON.stringify(first.killed));
  const killedArtifact = first.killed.artifact;
  const afterKill = inspect("export-artifacts");
  check(
    "export crash: the killed attempt wrote at most its own private file and minted no generation",
    added(afterKill).length <= 1 && first.latest.mail_generation_hash === null
      && auditCount("account.data_export_ready", first.id) === 0,
    JSON.stringify({ added: added(afterKill), baseline: cleanBefore.length, latest: first.latest }),
  );

  // Re-delivering the killed job is what the broker does once its reservation
  // expires. The re-execution has to clean up what the dead attempt left and
  // publish one coherent artifact, not a second one next to the first.
  docker(["start", "queue-exports"]);
  inspect("export-dispatch", String(first.id));
  const ready = await until("export crash: the re-execution publishes the artifact", () => {
    const state = inspect("export", String(first.id));
    return state.status === "ready" && state.artifact ? state : undefined;
  }, { deadlineMs: 240_000 }).catch((error) => {
    check("export crash: the re-execution publishes the artifact", false, `${error.message} :: ${whyStalled("queue-exports")}`);
    return null;
  });
  if (!ready) return;

  const published = inspect("export-artifacts");
  const publishedNew = added(published);
  check("export crash: the re-execution published exactly one ready state", auditCount("account.data_export_ready", first.id) === 1);
  check(
    "export crash: the re-execution created exactly one ready message",
    inspect("mail-kind", "data_export_ready").length - readyMailBefore === 1,
  );
  check(
    "export crash: the re-execution replaced the dead attempt's bytes instead of adding a second artifact",
    ready.artifact !== killedArtifact && publishedNew.length === 1 && publishedNew[0].name === ready.artifact,
    JSON.stringify({ added: publishedNew, killed: killedArtifact }),
  );
  // What the volume holds is ciphertext by blocks, so it is larger than the
  // payload: the chunked envelope costs about a third —base64 of each
  // authenticated block— so the artifact sits above the document and well
  // below twice it.
  check(
    "export crash: the stored artifact is the encrypted form of the payload",
    (publishedNew[0]?.bytes ?? 0) > seeded.json_bytes && (publishedNew[0]?.bytes ?? 0) < 2 * seeded.json_bytes,
    `bytes=${publishedNew[0]?.bytes} document=${seeded.json_bytes}`,
  );

  // --- download and acknowledgement ---------------------------------------
  // The ready message is only an announcement: it must reach the provider and
  // must not carry anything that could authorize a download on its own. The
  // anchor is ASCII so every mail encoding the provider can choose survives.
  const notices = await messagesFor(email);
  const notice = await messageMatching(email, (text) => /Ir a mis exportaciones|settings\/privacy/i.test(text));
  check(
    "export crash: the ready message announces the artifact without any bearer",
    Boolean(notice) && !tokenFromUrl(notice.raw),
    JSON.stringify({ outbox: inspect("mail-kind", "data_export_ready"), messages: notices.length }),
  );

  // A transfer that the client abandons after the headers must retire nothing.
  const controller = new AbortController();
  let interruptedStatus = 0;
  try {
    const response = await fetch(`${backend}/api/v1/auth/data-export/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        Cookie: `uvh_csrf=${csrfToken}; uvh_async_session=${session}`,
      },
      body: JSON.stringify({ password }),
      signal: controller.signal,
    });
    interruptedStatus = response.status;
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
  } catch {
    // Dropping the connection mid-body is the point of this phase.
  }
  const afterInterrupt = inspect("export", String(first.id));
  check(
    "export crash: an interrupted download retires nothing",
    interruptedStatus === 200 && afterInterrupt.status === "ready" && afterInterrupt.artifact === ready.artifact
      && auditCount("account.data_export_served", first.id) === 1,
    JSON.stringify({ http: interruptedStatus, row: afterInterrupt }),
  );

  const downloaded = await api("POST", "/api/v1/auth/data-export/download", { session, workspaceId, json: { password } });
  const bytes = Buffer.byteLength(downloaded.raw);
  // A body that is not JSON stays null, which the check below reports as a
  // download that did not serve the artifact.
  let payload = null;
  try {
    payload = JSON.parse(downloaded.raw);
  } catch {
    // Reported by the check that reads it.
  }
  check(
    "export crash: the artifact is served whole after the interruption",
    downloaded.status === 200 && auditCount("account.data_export_served", first.id) === 2,
    `HTTP ${downloaded.status} bytes=${bytes}`,
  );
  check(
    "export crash: the served payload is a complete large export",
    payload?.privacyRightsMessages?.length === messages
      && bytes > largeBytes && bytes <= capBytes,
    `messages=${payload?.privacyRightsMessages?.length ?? null} bytes=${bytes} cap=${capBytes}`,
  );

  const acknowledged = await api("POST", "/api/v1/auth/data-export/download/acknowledge", { session, workspaceId });
  const retiredReady = inspect("export", String(first.id));
  const afterAck = inspect("export-artifacts");
  check(
    "export crash: the acknowledgement retires the artifact",
    acknowledged.status === 200 && retiredReady.status === "downloaded" && retiredReady.artifact === null
      && names(afterAck) === names(cleanBefore),
    JSON.stringify({ http: acknowledged.status, row: retiredReady, files: afterAck }),
  );
  const reused = await api("POST", "/api/v1/auth/data-export/download", { session, workspaceId, json: { password } });
  check("export crash: the consumed export cannot be served again", reused.status === 410, `HTTP ${reused.status}`);

  // --- route two: the worker never comes back ------------------------------
  // The request is terminal now, so a second one is admitted. This time the
  // worker stays dead, which is the case the scheduled recovery stage exists
  // for: the request has to end terminal with no bearer, and the bytes the dead
  // attempt wrote must not survive it.
  const second = await killWorkerInsideExport("the abandoned export");
  if (!second) return;
  check("export crash: the abandoned attempt also died in flight", second.killed.status === "processing", JSON.stringify(second.killed));
  check("export crash: the abandoned attempt kept its anchor", second.killed.artifact !== null, JSON.stringify(second.killed));

  inspect("export-age", String(second.id));
  const housekeeping = housekeepingNow();
  const retired = inspect("export", String(second.id));
  const abandoned = inspect("export-latest");
  const afterRetire = inspect("export-artifacts");
  check("export crash: the scheduled recovery stage runs", housekeeping.exit === 0, JSON.stringify(housekeeping));
  check(
    "export crash: the abandoned request ends terminal, stalled and without a generation",
    retired.status === "failed" && retired.failure_reason === "stalled"
      && retired.artifact === null && abandoned.mail_generation_hash === null,
    JSON.stringify({ row: retired, latest: abandoned }),
  );
  check(
    "export crash: the abandoned attempt's bytes are deleted instead of orphaned",
    names(afterRetire) === names(cleanBefore)
      && (second.killed.artifact === null || !afterRetire.some((file) => file.name === second.killed.artifact)),
    JSON.stringify(afterRetire),
  );
  check("export crash: the abandoned request never published anything", auditCount("account.data_export_ready", second.id) === 0);

  // The topology is left as the drill found it: one consumer per pool.
  docker(["start", "queue-exports"]);
}
