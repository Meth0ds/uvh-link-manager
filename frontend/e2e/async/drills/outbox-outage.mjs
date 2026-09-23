/**
 * The mail runbook against a provider that is down.
 *
 * Registrations are still admitted, the refusal is recorded without losing the
 * envelope, the durable cycle exhausts, the administrative retry is admitted
 * and refused exactly when it should be, an exhausted lifecycle mail compensates
 * the resource it was tied to, and retention purges only what is terminal.
 */

import { exhaustOutbox, housekeepingNow } from "./support.mjs";
import { check, until } from "../expect.mjs";
import { attemptsFor, messagesFor, setState, tokenFromUrl } from "../fixtures.mjs";
import { api, password, register, uniqueEmail } from "../session.mjs";
import { control, docker, inspect } from "../topology.mjs";

/**
 * The mail runbook against a provider that is down, and the two recovery
 * surfaces it names: the administrative retry and the lifecycle compensation.
 */
export async function mailOutboxOutageDrill({ email, session, workspaceId }) {
  // Both alternatives of an accepted message, read from what the provider kept.
  const delivered = (await messagesFor(email))[0];
  const raw = delivered?.raw ?? "";
  check(
    "outbox outage: an accepted message carries HTML and text alternatives",
    /text\/html/i.test(raw) && /text\/plain/i.test(raw),
    `bytes=${raw.length}`,
  );

  // --- the provider is down -----------------------------------------------
  await setState(control.mail, { mode: "reject", rejectNext: 0 });
  const outageEmail = uniqueEmail("async-outage");
  const registered = await register(outageEmail, "Persona Caida");
  check(
    "outbox outage: registration is admitted while the provider is down",
    registered.status === 200 || registered.status === 201,
    `HTTP ${registered.status}`,
  );
  const pending = await until("outbox outage: the refusal is recorded without losing the message", () => {
    const row = inspect("mail", outageEmail)[0];
    return row && row.attempts >= 1 && row.status === "pending" && row.last_error === "transport_unavailable" ? row : undefined;
  }, { deadlineMs: 45_000 }).catch((error) => {
    check("outbox outage: the refusal is recorded without losing the message", false, error.message);
    return null;
  });
  if (!pending) return;
  check("outbox outage: the encrypted envelope survives the refusal", pending.envelope_bytes > 0, `bytes=${pending.envelope_bytes}`);

  const exhausted = await exhaustOutbox(outageEmail, pending.id);
  check(
    "outbox outage: the durable cycle exhausts to a terminal state",
    exhausted?.status === "failed" && exhausted.attempts >= 5 && exhausted.envelope_bytes > 0,
    JSON.stringify(exhausted),
  );
  if (exhausted?.status !== "failed") return;

  // --- the administrative retry, with the provider back --------------------
  await setState(control.mail, { mode: "accept", rejectNext: 0 });
  const admin = inspect("admin-session", email);
  if (!admin.token) {
    check("outbox outage: an administrative session is available", false, JSON.stringify(admin));
    return;
  }
  check(
    "outbox outage: an administrative session is granted for the operator surface",
    admin.granted_admin === true,
    `user_id=${admin.user_id}`,
  );

  const retried = await api("POST", `/api/v1/admin/mail-outbox/${exhausted.id}/retry`, { session: admin.token, workspaceId });
  check("outbox outage: the administrative retry is admitted", retried.status === 202, `HTTP ${retried.status} ${retried.raw.slice(0, 120)}`);
  const reset = inspect("mail-id", String(exhausted.id))[0];
  check(
    "outbox outage: the retry restarts the cycle without touching the bearer",
    // The worker may already have claimed or even delivered it again, which is
    // the point: the cycle restarts with a fresh attempt count, and the
    // envelope is only emptied by the acceptance that follows — never by the
    // retry itself.
    reset?.manual_retry_count === 1
      && ["pending", "queued", "processing", "sent"].includes(reset?.status ?? "")
      && (reset?.status === "sent" ? reset.envelope_bytes === 0 : reset.envelope_bytes > 0),
    JSON.stringify(reset),
  );
  const again = await api("POST", `/api/v1/admin/mail-outbox/${exhausted.id}/retry`, { session: admin.token, workspaceId });
  check("outbox outage: retrying a message that is no longer failed is refused", again.status === 409, `HTTP ${again.status}`);

  inspect("outbox-publish", outageEmail);
  const sent = await until("outbox outage: the retried message reaches the provider", () => {
    const row = inspect("mail-id", String(exhausted.id))[0];
    return row && row.status === "sent" ? row : undefined;
  }, { deadlineMs: 60_000, intervalMs: 1_000 }).catch((error) => {
    check("outbox outage: the retried message reaches the provider", false, error.message);
    return null;
  });
  if (sent) {
    const accepted = (await attemptsFor(outageEmail)).filter((attempt) => attempt.accepted).length;
    check("outbox outage: the provider accepted the retried message exactly once", accepted === 1, `accepted=${accepted}`);
    const token = (await messagesFor(outageEmail)).map((message) => tokenFromUrl(message.raw)).find(Boolean) ?? null;
    const verified = token ? await api("POST", "/api/v1/auth/verify-email", { json: { token, password } }) : { status: 0 };
    check(
      "outbox outage: the bearer from the retried message is still valid",
      verified.status === 200,
      `HTTP ${verified.status}`,
    );
  }

  // The failure path must not write the message, its bearer or the session into
  // the worker's log stream.
  const logs = docker(["logs", "--no-log-prefix", "queue-mail"], { capture: true });
  check(
    "outbox outage: the worker logs carry no bearer, cookie or password",
    !logs.includes("uvh_async_session=") && !logs.includes(password) && !/token=[A-Za-z0-9_-]{20,}/.test(logs),
    `bytes=${logs.length}`,
  );

  // --- the provider is down again: a lifecycle mail exhausts ----------------
  await setState(control.mail, { mode: "reject", rejectNext: 0 });
  const inviteEmail = uniqueEmail("async-compensation");
  const invited = await api("POST", `/api/v1/workspaces/${workspaceId}/invitations`, {
    session,
    workspaceId,
    json: { email: inviteEmail, role: "viewer" },
  });
  check(
    "outbox outage: the invitation is created while the provider is down",
    invited.status === 200 || invited.status === 201,
    `HTTP ${invited.status} ${invited.raw.slice(0, 120)}`,
  );
  const invitation = inspect("invitations").find((row) => row.email === inviteEmail) ?? null;
  if (!invitation) {
    check("outbox outage: the invitation is readable", false, JSON.stringify(inspect("invitations")));
    return;
  }
  const invitationMail = await until("outbox outage: the invitation mail is admitted", () => {
    const row = inspect("mail", inviteEmail)[0];
    return row && row.attempts >= 1 ? row : undefined;
  }, { deadlineMs: 45_000 }).catch(() => null);
  if (!invitationMail) {
    check("outbox outage: the invitation mail is admitted", false, "no outbox row");
    return;
  }
  const compensated = await exhaustOutbox(inviteEmail, invitationMail.id);
  check(
    "outbox outage: an exhausted lifecycle mail goes to compensation",
    ["comp_pending", "compensated"].includes(compensated?.status ?? ""),
    JSON.stringify(compensated),
  );
  housekeepingNow();
  const afterCompensation = inspect("mail-id", String(invitationMail.id))[0] ?? null;
  const invitationAfter = inspect("invitations").find((row) => row.id === invitation.id) ?? null;
  check(
    "outbox outage: the compensation cancels the invitation it was tied to",
    afterCompensation?.status === "compensated" && invitationAfter?.status === "cancelled",
    JSON.stringify({ outbox: afterCompensation?.status, invitation: invitationAfter?.status }),
  );

  // --- retention -----------------------------------------------------------
  if (sent) {
    inspect("outbox-age", `${sent.id} 31`);
    housekeepingNow();
    const purged = inspect("mail-id", String(sent.id));
    const openWork = inspect("mail-id", String(invitationMail.id));
    check(
      "outbox outage: a terminal row past retention is purged",
      purged.length === 0,
      `rows=${purged.length}`,
    );
    check(
      "outbox outage: the same pass does not purge open work",
      openWork.length === 1 && openWork[0]?.status === "compensated",
      JSON.stringify(openWork),
    );
  }
}
