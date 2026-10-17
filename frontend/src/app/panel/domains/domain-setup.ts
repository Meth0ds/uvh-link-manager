import type { DomainDto } from "../../core/models";

export function domainSetupSteps(domain: DomainDto): { label: string; complete: boolean }[] {
  return [
    { label: $localize`:@@ui.ec6da997fe2be3:Subdominio añadido`, complete: true },
    { label: $localize`:@@ui.ade792d6fd9629:DNS comprobado`, complete: domain.ownershipStatus === "verified" && domain.routingStatus === "healthy" && domain.dnsError === null && !domain.dnsCheckInProgress },
    { label: $localize`:@@ui.01e0f204e75c47:HTTPS preparado`, complete: domain.tlsReadyAt !== null && (domain.tlsStatus === "ready" || domain.tlsStatus === "expiring") },
    { label: $localize`:@@ui.f4e4f699637be8:Disponible`, complete: domain.servingReady },
  ];
}

export function domainSetupAdvice(domain: DomainDto): string {
  if (domain.dnsCheckInProgress) return $localize`:@@ui.d2b0e3698aaeea:Estamos comprobando los registros publicados. El resultado se actualizará automáticamente.`;
  if (domain.tlsStatus === "provisioning") return $localize`:@@ui.d50da1a30cb0dd:La comprobación DNS terminó y estamos preparando HTTPS. Esta página seguirá el progreso.`;
  if (domain.desiredState === "disabled") return $localize`:@@ui.a3cc2a3da78164:El dominio está desactivado. Comprueba sus registros antes de volver a conectarlo.`;
  if (domain.dnsError === "domain_claimed_elsewhere") return $localize`:@@ui.c771f93a123409:Otro workspace ha demostrado la propiedad. Revisa con el propietario quién debe gestionar este subdominio.`;
  if (domain.routingObservedProxied) return $localize`:@@ui.15d8bb34141e3a:La respuesta DNS sugiere un proxy o flattening. Revisa que el CNAME sea directo; en Cloudflare selecciona DNS only.`;
  if (domain.dnsError === "ownership_missing" || domain.dnsError === "ownership_and_routing_missing") return $localize`:@@ui.bf5e71bf820193:Revisa el nombre y el valor del TXT de propiedad. Después comprueba también el CNAME y vuelve a comprobar la conexión.`;
  if (domain.dnsError === "routing_missing") return $localize`:@@ui.4edd5c7c94b8eb:Corrige el CNAME para que apunte al destino mostrado. Si acabas de guardarlo, espera a que se propague antes de reintentar.`;
  if (domain.caaAllowsIssuer === false) return $localize`:@@ui.ab759dc734dfcb:Revisa los registros CAA: deben permitir la entidad emisora indicada en el diagnóstico HTTPS.`;
  if (domain.tlsError) return $localize`:@@ui.7831b4f4ea92ac:Revisa DNS y CAA antes de reintentar HTTPS. Se respetarán los tiempos de espera del servidor.`;
  if (domain.dnsError) return $localize`:@@ui.f29e8962af5a28:La última comprobación no pudo completarse. Consulta el motivo y vuelve a intentarlo cuando termine el tiempo de espera.`;
  if (domain.servingReady) return $localize`:@@ui.ffff0fdea7a7e6:El dominio está disponible para crear enlaces. Conserva los registros TXT y CNAME para mantener la conexión.`;
  return $localize`:@@ui.6f10883e2c9ce5:Añade los registros que aparecen debajo y pulsa Comprobar conexión. Al confirmar DNS, UVH preparará HTTPS cuando corresponda.`;
}
