import type { WorkspaceGettingStarted } from "../../core/models";

export interface GettingStartedStep {
  id: string;
  icon: string;
  title: string;
  description: string;
  observed: boolean;
  optional: boolean;
  route: string;
  action: string;
  fragment?: string;
}

/** Present observations, not claims of personal testing or production readiness. */
export function gettingStartedSteps(data: WorkspaceGettingStarted): GettingStartedStep[] {
  const f = data.facts;
  const c = data.capabilities;
  return [
    {
      id: "link", icon: "add_link", title: "Crear el primer enlace", observed: f.linkPresent, optional: false,
      description: f.linkPresent ? "Hay al menos un enlace que no está en la papelera."
        : c.createLink ? "Crea un enlace con un destino que conozcas desde Enlaces."
          : "Todavía no hay enlaces. Pide a un editor o administrador que cree el primero.",
      route: "/app/links", action: c.createLink ? "Gestionar enlaces" : "Ver enlaces",
    },
    {
      id: "redirect", icon: "call_made", title: "Comprobar una redirección", observed: f.redirectObserved, optional: false,
      description: f.redirectObserved
        ? "UVH ha registrado una redirección. Esto no prueba que tú llegaras al destino esperado: compruébalo manualmente."
        : "Abre manualmente un enlace desde su detalle, comprueba el destino y vuelve a actualizar esta guía. Los enlaces de un uso se consumen al abrirlos.",
      route: "/app/links", action: "Elegir enlace",
    },
    {
      id: "mfa", icon: "verified_user", title: "Proteger tu cuenta con MFA", observed: f.mfaEnabled, optional: false,
      description: f.mfaEnabled ? "El segundo factor está activado en tu cuenta. Conserva tus códigos de recuperación en un lugar seguro."
        : "Activa el segundo factor en Acceso y seguridad. La guía no modifica tus credenciales.",
      route: "/app/settings", fragment: "security", action: "Acceso y seguridad",
    },
    {
      id: "domain", icon: "language", title: "Añadir un dominio propio", observed: f.domainPresent, optional: true,
      description: f.domainPresent ? "Hay un dominio añadido. Consulta por separado su verificación DNS, certificado TLS y activación."
        : "Puedes usar el dominio compartido. Añade uno propio sólo si lo necesitas.",
      route: "/app/domains", action: c.addDomain ? "Gestionar dominios" : "Ver dominios",
    },
    {
      id: "team", icon: "group_add", title: "Trabajar en equipo", observed: f.teammatePresent || f.invitationPending === true, optional: true,
      description: f.teammatePresent ? "Hay otro miembro verificado con acceso al workspace."
        : f.invitationPending === true ? "Hay una invitación vigente; no significa que el correo haya llegado o que se haya aceptado."
          : c.inviteTeam ? "Invita a otra persona con el rol mínimo necesario, si vas a colaborar."
            : "Puedes consultar el equipo. Sólo propietarios y administradores pueden invitar.",
      route: "/app/team", action: c.inviteTeam ? "Gestionar equipo" : "Ver equipo",
    },
  ];
}
