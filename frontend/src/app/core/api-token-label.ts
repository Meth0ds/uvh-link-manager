/**
 * What the token registry says about one API token.
 *
 * A revoked token is kept in the list on purpose, so its state is part of what the
 * row has to say rather than a detail of it. The row prints that state twice — as
 * a chip and as the label of the revoke control, which reads "Revocar" while the
 * credential still works and "Revocado" once it does not — and both readings come
 * from here so they cannot drift apart.
 */

/** The state of the credential, as the row's chip prints it. */
export const TOKEN_STATE_LABEL = {
  revoked: "Revocado",
  active: "Activo",
} as const;

/** What the revoke control reads: the action while it can still be taken. */
export const TOKEN_ACTION_LABEL = {
  revoked: "Revocado",
  active: "Revocar",
} as const;

export function tokenStateLabel(revoked: boolean): string {
  return revoked ? TOKEN_STATE_LABEL.revoked : TOKEN_STATE_LABEL.active;
}

export function tokenActionLabel(revoked: boolean): string {
  return revoked ? TOKEN_ACTION_LABEL.revoked : TOKEN_ACTION_LABEL.active;
}

/** The icon the row draws for the state. */
export function tokenStateIcon(revoked: boolean): string {
  return revoked ? "key_off" : "key";
}

/**
 * The accessible name of the revoke control, which has to say two things at once:
 * which token, and whether it is still there to revoke.
 *
 * It keeps the registry's own wording (the sentence a screen reader reads is the
 * same one the row shows) rather than the button's shorter visible label.
 */
export function tokenActionAriaLabel(revoked: boolean, name: string): string {
  return revoked ? `Token revocado: ${name}` : `Revocar token: ${name}`;
}
