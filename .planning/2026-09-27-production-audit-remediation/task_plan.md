# Production audit remediation

Objetivo: corregir todos los hallazgos del informe adjunto y continuar QA intensivo hasta satisfacer las puertas de producción verificables; no declarar preparación real sin evidencia de infraestructura y operación.

Base comprobada: baa28305, árbol limpio salvo planes locales.
Informe: /Users/roberto/.codex/attachments/1eee28c4-169f-4d5a-857a-bf9b64de74d6/pasted-text-1.txt

## Fases y requisitos
- [x] P1 interceptor: todos los namespaces F7 llevan workspace y clasificación de sesión común; pruebas por endpoint, lecturas/escrituras y MFA/401.
- [x] P1 locks: tags, colecciones y plantillas revalidan autoridad bajo lock transaccional antes de recursos; tests expulsión/degradación/version de seguridad.
- [ ] P1/P3 artifacts: lecturas estrictas, fallos I/O nunca EOF, V3 con integridad/completitud autenticada; generación, descarga y rotación preservan invariantes, compatibilidad legacy explícita.
- [x] P2 legacy resend: fallo outbox genérico sin null dereference, audit correcto y tests.
- [ ] P2 idempotencia: fencing obligatorio al commit, renovación y carreras de takeover; import refleja ledger autoritativo.
- [x] P2 versiones/eventos: rename/merge tags y borrar colección incrementan versión/updated_at y notifican link.updated; pruebas edición obsoleta.
- [ ] P2 CSV preflight: duplicados, alias existentes, cuota y referencias conforme snapshot actual; import no promete éxito futuro.
- [x] P2 bulk move/delete: bloqueo/revalidación de colección dentro de transacción, respuesta controlada.
- [ ] P3 CSV tags reversible con punto y coma; documentar contrato de transferencia frente a backup completo.
- [ ] P3 resend timing: evaluar y reforzar camino observable, pruebas y límites medidos.
- [ ] QA ampliado: calidad, suites unitarias/integradas, E2E crítico, colas, arranque producción, backups, supply chain y revisión adicional de código; reparar fallos encontrados.
- [ ] Auditoría de cierre: inspeccionar CI actual y puertas externas; tabla requisito/evidencia/pendiente sin dar por cerrado lo no probado.

## Next Step
Continuar con fencing/renovación del lease e import CSV autoritativo. Después V3 con manifest autenticado, dry-run y tags reversibles, timing resend, QA global e infraestructura. Lecturas fail-closed corregidas; V3 aún pendiente.

## Clasificación del turno previo
Progreso: interceptor, autoridad F7, versiones/eventos relacionados, carrera colección/bulk, lectura estricta y error de correo legacy corregidos y verificados. Objetivo completo sigue activo.
