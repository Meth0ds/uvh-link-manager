import { boolean, record, text } from "./response-decoder-helpers";

export interface PublicActionMessage {
  ok: true;
  message: string;
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
