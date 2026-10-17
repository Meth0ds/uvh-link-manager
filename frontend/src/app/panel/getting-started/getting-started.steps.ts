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
      id: "link", icon: "add_link", title: $localize`:@@ui.da715e760f0499:Crear el primer enlace`, observed: f.linkPresent, optional: false,
      description: f.linkPresent ? $localize`:@@ui.b75fddb5a009d2:Hay al menos un enlace que no está en la papelera.`
        : c.createLink ? $localize`:@@ui.f75d77771a4461:Crea un enlace con un destino que conozcas desde Enlaces.`
          : $localize`:@@ui.98a55c3f20671e:Todavía no hay enlaces. Pide a un editor o administrador que cree el primero.`,
      route: "/app/links", action: c.createLink ? $localize`:@@ui.578708dfd25fb0:Gestionar enlaces` : $localize`:@@ui.ff7267d90a63b2:Ver enlaces`,
    },
    {
      id: "redirect", icon: "call_made", title: $localize`:@@ui.92be2b648de6d6:Comprobar una redirección`, observed: f.redirectObserved, optional: false,
      description: f.redirectObserved
        ? $localize`:@@ui.73cc137d6d1c47:UVH ha registrado una redirección. Esto no prueba que tú llegaras al destino esperado: compruébalo manualmente.`
        : $localize`:@@ui.9ef413f067622a:Abre manualmente un enlace desde su detalle, comprueba el destino y vuelve a actualizar esta guía. Los enlaces de un uso se consumen al abrirlos.`,
      route: "/app/links", action: $localize`:@@ui.9f27f3c9fc518e:Elegir enlace`,
    },
    {
      id: "mfa", icon: "verified_user", title: $localize`:@@ui.e84259183202c2:Proteger tu cuenta con MFA`, observed: f.mfaEnabled, optional: false,
      description: f.mfaEnabled ? $localize`:@@ui.5a30cba14b627e:El segundo factor está activado en tu cuenta. Conserva tus códigos de recuperación en un lugar seguro.`
        : $localize`:@@ui.7c2b035b84bd41:Activa el segundo factor en Acceso y seguridad. La guía no modifica tus credenciales.`,
      route: "/app/settings", fragment: "security", action: $localize`:@@ui.c95ad05d6312a1:Acceso y seguridad`,
    },
    {
      id: "domain", icon: "language", title: $localize`:@@ui.1fdb33a8ba1291:Añadir un dominio propio`, observed: f.domainPresent, optional: true,
      description: f.domainPresent ? $localize`:@@ui.9132a1c8fbac77:Hay un dominio añadido. Consulta por separado su verificación DNS, certificado TLS y activación.`
        : $localize`:@@ui.e6208dc18296cd:Puedes usar el dominio compartido. Añade uno propio sólo si lo necesitas.`,
      route: "/app/domains", action: c.addDomain ? $localize`:@@ui.8d5ef78befeaf6:Gestionar dominios` : $localize`:@@ui.4ef58289ce7c83:Ver dominios`,
    },
    {
      id: "team", icon: "group_add", title: $localize`:@@ui.91fe71fd2bab59:Trabajar en equipo`, observed: f.teammatePresent || f.invitationPending === true, optional: true,
      description: f.teammatePresent ? $localize`:@@ui.94123aec6e2370:Hay otro miembro verificado con acceso al workspace.`
        : f.invitationPending === true ? $localize`:@@ui.319637fc8964ba:Hay una invitación vigente; no significa que el correo haya llegado o que se haya aceptado.`
          : c.inviteTeam ? $localize`:@@ui.cd4f4d6f48be6a:Invita a otra persona con el rol mínimo necesario, si vas a colaborar.`
            : $localize`:@@ui.8a6a770ea83462:Puedes consultar el equipo. Sólo propietarios y administradores pueden invitar.`,
      route: "/app/team", action: c.inviteTeam ? $localize`:@@ui.f9f13088090920:Gestionar equipo` : $localize`:@@ui.bc41cab78281cf:Ver equipo`,
    },
  ];
}
