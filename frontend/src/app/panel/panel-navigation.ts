import type { AuthUser, Workspace } from "../core/models";

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  workspaceAdminOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const PANEL_NAVIGATION: NavGroup[] = [
    {
      label: "Trabajo",
      items: [
        { path: "/app/dashboard", label: "Panel", icon: "space_dashboard" },
        { path: "/app/getting-started", label: "Primeros pasos", icon: "checklist" },
        { path: "/app/links", label: "Enlaces", icon: "link" },
        { path: "/app/analytics", label: "Analítica", icon: "query_stats" },
        { path: "/app/usage", label: "Uso y límites", icon: "data_usage" },
        { path: "/app/activity", label: "Actividad", icon: "history", workspaceAdminOnly: true },
        { path: "/app/domains", label: "Dominios", icon: "language" },
      ],
    },
    {
      label: "Integraciones",
      items: [
        { path: "/app/tokens", label: "Tokens API", icon: "key" },
        { path: "/app/webhooks", label: "Webhooks", icon: "webhook" },
      ],
    },
    {
      label: "Cuenta",
      items: [
        { path: "/app/team", label: "Equipo", icon: "group" },
        { path: "/app/notifications", label: "Notificaciones", icon: "notifications" },
        { path: "/app/security", label: "Centro de seguridad", icon: "security" },
        { path: "/app/settings", label: "Ajustes", icon: "settings" },
      ],
    },
    {
      label: "Sistema",
      items: [{ path: "/app/admin", label: "Admin", icon: "admin_panel_settings", adminOnly: true }],
    },
  ];

export function canEditLinks(user: AuthUser | null, role: Workspace["role"]): boolean {
  return user?.emailVerified === true && ["owner", "admin", "editor"].includes(role ?? "");
}

export function visiblePanelNavigation(user: AuthUser | null, role: Workspace["role"]): NavGroup[] {
  const workspaceAdmin = user?.emailVerified === true && (role === "owner" || role === "admin");
  return PANEL_NAVIGATION.map(group => ({ ...group, items: group.items.filter(item =>
    (!item.adminOnly || user?.isAdmin === true) && (!item.workspaceAdminOnly || workspaceAdmin)) }))
    .filter(group => group.items.length > 0);
}
