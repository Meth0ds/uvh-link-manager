import type { DomainDto } from "../../core/models";

export function domainSetupSteps(domain: DomainDto): { label: string; complete: boolean }[] {
  return [
    { label: "Subdominio añadido", complete: true },
    { label: "DNS comprobado", complete: domain.ownershipStatus === "verified" && domain.routingStatus === "healthy" && domain.dnsError === null && !domain.dnsCheckInProgress },
    { label: "HTTPS preparado", complete: domain.tlsReadyAt !== null && (domain.tlsStatus === "ready" || domain.tlsStatus === "expiring") },
    { label: "Disponible", complete: domain.servingReady },
  ];
}

export function domainSetupAdvice(domain: DomainDto): string {
  if (domain.dnsCheckInProgress) return "Estamos comprobando los registros publicados. El resultado se actualizará automáticamente.";
  if (domain.tlsStatus === "provisioning") return "La comprobación DNS terminó y estamos preparando HTTPS. Esta página seguirá el progreso.";
  if (domain.desiredState === "disabled") return "El dominio está desactivado. Comprueba sus registros antes de volver a conectarlo.";
  if (domain.dnsError === "domain_claimed_elsewhere") return "Otro workspace ha demostrado la propiedad. Revisa con el propietario quién debe gestionar este subdominio.";
  if (domain.routingObservedProxied) return "La respuesta DNS sugiere un proxy o flattening. Revisa que el CNAME sea directo; en Cloudflare selecciona DNS only.";
  if (domain.dnsError === "ownership_missing" || domain.dnsError === "ownership_and_routing_missing") return "Revisa el nombre y el valor del TXT de propiedad. Después comprueba también el CNAME y vuelve a comprobar la conexión.";
  if (domain.dnsError === "routing_missing") return "Corrige el CNAME para que apunte al destino mostrado. Si acabas de guardarlo, espera a que se propague antes de reintentar.";
  if (domain.caaAllowsIssuer === false) return "Revisa los registros CAA: deben permitir la entidad emisora indicada en el diagnóstico HTTPS.";
  if (domain.tlsError) return "Revisa DNS y CAA antes de reintentar HTTPS. Se respetarán los tiempos de espera del servidor.";
  if (domain.dnsError) return "La última comprobación no pudo completarse. Consulta el motivo y vuelve a intentarlo cuando termine el tiempo de espera.";
  if (domain.servingReady) return "El dominio está disponible para crear enlaces. Conserva los registros TXT y CNAME para mantener la conexión.";
  return "Añade los registros que aparecen debajo y pulsa Comprobar conexión. Al confirmar DNS, UVH preparará HTTPS cuando corresponda.";
}
