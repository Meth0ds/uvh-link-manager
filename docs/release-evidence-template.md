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
- [ ] Export pequeño y máximo; OOM rechazado, worker/volumen/red interrumpidos y reintento de descarga.
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
