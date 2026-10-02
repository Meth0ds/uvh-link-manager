import { boolean, record, text } from "./response-decoder-helpers";

export interface PublicActionMessage {
  ok: true;
  message: string;
}

export function decodePublicActionAcknowledgement(value: unknown): { ok: true } {
  const source = record(value, "public action acknowledgement");
  if (!boolean(source["ok"], "public action acknowledgement")) throw new Error("Invalid public action acknowledgement response");
  return { ok: true };
}

/** Credential bearers can affect a different account than the browser session. */
export function decodeCredentialChange(value: unknown): { ok: true; current: boolean } {
  const source = record(value, "credential change");
  return { ...decodePublicActionAcknowledgement(value), current: boolean(source["current"], "credential change") };
}

/** Decode only public confirmation text; never retain unrelated response keys. */
export function decodePublicActionMessage(value: unknown): PublicActionMessage {
  const source = record(value, "public action");
  if (!boolean(source["ok"], "public action")) throw new Error("Invalid public action response");
  return {
    ok: true,
    message: text(source["message"], "public action", 500),
  };
}

export function decodeSecurityIncident(value: unknown): PublicActionMessage & { current: boolean } {
  const source = record(value, "security incident");
  return {
    ...decodePublicActionMessage(value),
    current: boolean(source["current"], "security incident"),
  };
}

export function decodeAccountDeletionConfirmation(value: unknown): { ok: true; executeAfter: string } {
  const source = record(value, "account deletion confirmation");
  const executeAfter = text(source["executeAfter"], "account deletion confirmation", 64);
  if (!boolean(source["ok"], "account deletion confirmation")) {
    throw new Error("Invalid account deletion confirmation response");
  }
  if (!Number.isFinite(Date.parse(executeAfter))) throw new Error("Invalid account deletion confirmation response");
  return {
    ok: true,
    executeAfter,
  };
}
