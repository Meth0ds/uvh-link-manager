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
      label: $localize`:@@ui.e1ddc0cbc9891e:Trabajo`,
      items: [
        { path: "/app/dashboard", label: $localize`:@@ui.d0d91173008b6f:Panel`, icon: "space_dashboard" },
        { path: "/app/getting-started", label: $localize`:@@ui.62f909f1b76248:Primeros pasos`, icon: "checklist" },
        { path: "/app/links", label: $localize`:@@ui.f1a5125bb4f0ad:Enlaces`, icon: "link" },
        { path: "/app/analytics", label: $localize`:@@ui.f5b4c86a85509e:Analítica`, icon: "query_stats" },
        { path: "/app/usage", label: $localize`:@@ui.69cceceabf3e75:Uso y límites`, icon: "data_usage" },
        { path: "/app/activity", label: $localize`:@@ui.d134a8ecb32a6e:Actividad`, icon: "history", workspaceAdminOnly: true },
        { path: "/app/domains", label: $localize`:@@ui.3facb8d257990f:Dominios`, icon: "language" },
      ],
    },
    {
      label: $localize`:@@ui.5beed665025da3:Integraciones`,
      items: [
        { path: "/app/tokens", label: $localize`:@@ui.f6d9f8f2874f90:Tokens API`, icon: "key" },
        { path: "/app/webhooks", label: $localize`:@@ui.45808d75bf8911:Webhooks`, icon: "webhook" },
      ],
    },
    {
      label: $localize`:@@ui.e436ddcd06e85c:Cuenta`,
      items: [
        { path: "/app/team", label: $localize`:@@ui.c29446754ae19b:Equipo`, icon: "group" },
        { path: "/app/notifications", label: $localize`:@@ui.80dade6fab6f93:Notificaciones`, icon: "notifications" },
        { path: "/app/security", label: $localize`:@@ui.c49ad80a26577d:Centro de seguridad`, icon: "security" },
        { path: "/app/settings", label: $localize`:@@ui.4f2debbbf4fab6:Ajustes`, icon: "settings" },
      ],
    },
    {
      label: $localize`:@@ui.f150afd3c5994d:Sistema`,
      items: [{ path: "/app/admin", label: $localize`:@@ui.c1c224b03cd9bc:Admin`, icon: "admin_panel_settings", adminOnly: true }],
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
