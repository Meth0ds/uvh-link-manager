/**
 * What the admin directory says about one account.
 *
 * A row shows the access state and then the flags that qualify it (privilege,
 * mailbox, second factor). The directory filter offers those same states as its
 * options, so the words are defined once here instead of twice in the template —
 * they used to disagree: the row said "Administradores" in the filter and "Admin"
 * on the badge of the very same account.
 */

/** Whether the account can sign in at all. */
export const ADMIN_ACCOUNT_STATE_LABEL = {
  blocked: "Bloqueada",
  active: "Activa",
} as const;

/**
 * The qualifiers a directory row prints next to the access state.
 *
 * `unverified` stays as a badge only: a registration without a proven mailbox
 * is not a user any more, so the filter that once selected them is gone — what
 * it pretended to list is the pending-registrations queue of the console.
 */
export const ADMIN_ACCOUNT_FLAG_LABEL = {
  admin: "Admin",
  unverified: "Sin verificar",
  mfa: "MFA",
} as const;

/**
 * The directory filter's options, in the order the filter shows them.
 *
 * Derived from the maps above, and the values are what the API expects.
 */
export const ADMIN_USER_FILTERS = [
  { value: "active", label: ADMIN_ACCOUNT_STATE_LABEL.active },
  { value: "blocked", label: ADMIN_ACCOUNT_STATE_LABEL.blocked },
  { value: "admin", label: ADMIN_ACCOUNT_FLAG_LABEL.admin },
  { value: "mfa", label: ADMIN_ACCOUNT_FLAG_LABEL.mfa },
] as const;

export type AdminUserFilterValue = (typeof ADMIN_USER_FILTERS)[number]["value"];

export function adminAccountStateLabel(blocked: boolean): string {
  return blocked ? ADMIN_ACCOUNT_STATE_LABEL.blocked : ADMIN_ACCOUNT_STATE_LABEL.active;
}
