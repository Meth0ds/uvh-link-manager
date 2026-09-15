# Expediente de evidencia de release UVH

Copiar este archivo fuera del árbol de fuentes para cada candidato. No marcar
un punto por existencia de código: adjuntar salida, fecha UTC, responsable,
commit y digest inmutable. No incluir secretos, tokens, direcciones personales
ni cuerpos de correo/webhook.

## Identidad del candidato

- Commit:
- Digest `uvh-api`:
- Digest `uvh-web`:
- Entorno y fecha UTC:
- Responsable ejecutor:
- Responsable aprobador independiente:

## Gates automatizados

- [ ] CI del commit: frontend lint/typecheck/unit/build, backend Pint/Larastan/PHPUnit.
- [ ] E2E funcional desde checkout limpio y base efímera terminada en `_test`.
- [ ] E2E de imágenes: Caddy → Nginx → PHP-FPM, rutas directas, CSP, HSTS y hosts.
- [ ] `uvh:release-check` positivo y pruebas negativas de configuración/esquema.
- Enlaces a artefactos y logs saneados:

## Proveedores y recorridos reales controlados

- [ ] hCaptcha app y público, incluido fallo cerrado del proveedor.
- [ ] Correo recibido por buzón de prueba; latencia y duplicados observados.
- [ ] Webhook HTTPS firmado; timeout, 5xx, reintento, duplicado y recuperación.
- [ ] DNS/TLS en subdominio de prueba con CNAME directo; desactivación y renovación.
- Evidencias:

## Capacidad y fallos

- [ ] Redirección: carga, p50/p95/p99, errores y bloqueos PostgreSQL.
- [ ] Saturación independiente de mail/webhooks/domains/exports/analytics.
- [ ] Rollups analíticos: contención sobre una misma fila `link_id + day` con
  backlog real y varios workers, fidelidad de contadores y techo del pool.
  Método, números de referencia y límites del ensayo:
  [`analytics-rollup-capacity.md`](analytics-rollup-capacity.md).
- [ ] Export pequeño y máximo; OOM rechazado, worker/volumen/red interrumpidos y reintento de descarga.
- [ ] Ráfaga desde un solo origen contra la superficie pública y el panel con
  el borde activo: el rechazo es del borde (no del `throttle` de Laravel), el
  `429` lleva `Retry-After`, y ningún cliente legítimo por debajo del límite de
  Laravel se quedó fuera. Requisito de despliegue previo: capa de CDN/WAF
  contratada por delante.
- [ ] Reputación de destinos: proveedor elegido y evaluado; tasa de falsos
  positivos observada con auto-bloqueo desactivado; umbrales de auto-bloqueo
  aprobados; el propio dominio no aparece mal valorado. Método y límites:
  [`url-reputation-runbook.md`](url-reputation-runbook.md).
- [ ] Carreras de papelera/restore/purge/housekeeping.
- Evidencias y umbrales aprobados:

## Recuperación operativa

- [ ] Backup cifrado identificado y restaurado en un entorno aislado.
- [ ] RPO/RTO medidos y aprobados.
- [ ] Alerta de caída recibida por un canal externo con UVH apagado.
- [ ] Rotación de secretos ensayada sin exponer valores.
- [ ] Migración y rollback/reenvío practicados con datos ficticios representativos.
- Evidencias:

## Legal y decisión final

- [ ] `LEGAL_ENTITY_NAME`, `LEGAL_TAX_ID`, `LEGAL_ADDRESS`,
  `LEGAL_REGISTRY_DETAILS`, `LEGAL_HOSTING_PROVIDER` y
  `LEGAL_HOSTING_REGION` contienen datos revisados; producción rechaza vacíos y
  marcadores.
- [ ] Términos, privacidad, encargados, región y transferencias revisados por la
  persona competente.
- [ ] Riesgos residuales y plan de rollback aceptados.
- Resultado: `APROBADA` / `RECHAZADA`
- Firma/fecha de aprobación:
