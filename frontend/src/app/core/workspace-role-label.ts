import type { WorkspaceRole } from "./models";

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];

/**
 * How a workspace role is written in the panel.
 *
 * The sidebar, the team list (members, invitations and the role selects) and the
 * usage page all read this map. They used to name the same role differently —
 * "Solo lectura", "Visor" and "Visualizador" for `viewer` — so the member list
 * could contradict the page next to it.
 */
export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Visor",
};

export function workspaceRoleLabel(role: WorkspaceRole): string {
  return WORKSPACE_ROLE_LABEL[role];
}

/** Whether a value the API returned is a role this vocabulary can name. */
export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (ROLES as readonly string[]).includes(value);
}
