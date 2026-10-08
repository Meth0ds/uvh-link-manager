# O67 — Equipo: permisos, contexto y diseño

Objetivo global S01–S13 abierto. Este lote revisa TeamComponent completo, su HTML/SCSS, lectores/slots y contratos relevantes de WorkspaceController. No cierra equipo/backend por sí solo.

## Diseño antes de implementar

Conservar Manrope y tokens de UVH: tinta #262821, acento #b53c20, superficie #fffcf5, fondo #f5f2e9 y peligro #b12e30 (los tokens efectivos de cada tema siguen siendo la autoridad). Identidad del workspace y acceso propio primero; miembros e invitaciones como filas legibles con acciones contextualizadas; propiedad/eliminación separadas de la gestión cotidiana. Texto principal 14–18 px; nombres y emails largos pueden ocupar más de una línea. Alineación izquierda; controles de al menos 44 px y separaciones consistentes.

Revisión del plan: no añadir estadísticas, sombras ni nuevas etiquetas ornamentales. La estructura responde a quién puede actuar sobre quién; no ofrece permisos que el backend no concede. Una persona sin gestión ve información y su salida del equipo.

## Secuencia

1. Reproducir con pruebas nativas las respuestas tardías, pérdida de borradores, búsqueda durante debounce y controles de roles.
2. Corregir contexto/propietario de mutaciones, snapshots y guardas locales; autorización API conservada.
3. Mejorar identidad, acciones, etiquetas accesibles y composición móvil.
4. Ejecutar suites afectadas, suite frontend, tipos, lint/build; QA del build con API ficticia aislada.
5. Registrar cambios/evidencia y pendientes sin reescribir manifests históricos.

Sin DB/cuentas/mail/proveedores/migraciones/control compartido/commit/publicación.

La captura visual confirma la paleta editorial cálida existente y su variante oscura. Se corrigen aquí los valores de referencia iniciales: el código utiliza los tokens compartidos de UVH y no introduce una paleta azul.


## O67 — equipo: permisos, contexto y acciones (07/10)

Siete bugs de consumidor corregidos, todos P2: **B223**, respuestas/recargas borran borradores posteriores de email/nombre (también fallo y retry); **B224**, slot global y feedback/follow-up tardíos atraviesan workspace/selección/rol/cuenta/destrucción; **B225**, administrador recibe acciones de administrador reservadas al propietario; **B226**, búsqueda antigua publica candidatos durante el debounce; **B227**, selección Material muestra el rol rechazado; **B228**, editor/viewer no pueden abandonar por UI; **B229**, controles de rol/removal/invitación carecen de identidad accesible.

Código completo TeamComponent/HTML/SCSS leído; diez funciones backend conciliadas por permiso/payload/efecto, sin nueva ejecución SQL. Reutilización de OwnedMutations, captura de contexto y GET abortable; credenciales capturadas antes de confirmar y guardas de exclusión posteriores. No autorización delegada al frontend. Formularios de nombre sólo para gestión; salida personal separada de propiedad/eliminación; acciones con texto y separación; nombres/correos completos y texto funcional 13–18 px. Destinatario seleccionado móvil ocupa el ancho disponible y permite elegir otra persona con CTA visible.

**24 casos nuevos y 1565/1565 frontend finales**, tipos/lint/build terminal0. Trece rojos nativos válidos: once iniciales, uno de borrador tras fallo/retry y uno de discrepancia de rol detectado durante implementación. Una comprobación geométrica de navegador además mostró identidad de destinatario 97/224 px (43%); tras ajuste usa al menos75% en320px. No se confunden los fallos de preparación/fixture con bugs: ruta de escritura errónea, doble genérico, proveedor Material/detectChanges y búsqueda «ana» sin coincidencias se conservan en logs separados.

QA del build/API ficticia loopback8487: **32 estados**, cuatro roles,1440/390/320, ambos temas y movimiento nativo; búsqueda/team503→retry GET único, destinatario largo seleccionado y cancelación por teclado. Controles de gestión≥44px y sin overflow global/área principal. Cero comandos API reales o ficticios; no correo/transferencia/eliminación real ni lectores de pantalla reales. El foco tras eliminación efectiva de una fila requiere cobertura adicional; no se da por acreditado por cancelar un diálogo.

Comparación: **3 fuentes de producto**,1spec nuevo y2 dobles adaptados dentro de1spec existente (expectativas/casos anteriores intactos); **117 specs previas íntegros**,826 fuentes previas ajenas sin cambios y833 hashes actuales. `uvh-control.mjs` y su test cambiaron concurrentemente y se registran aparte con snapshots/hashes, sin ejecución ni edición por este lote. `panel/src/app/panel-api.service.ts` también está modificado fuera del conjunto indexado; se conserva. Manifests históricos O64–O66 intactos. Inventario estático501/2378named/1277anonymous/3firmas/0provisional; ledger parcial S03 con34 anchors. Enumerar scripts no acredita revisión/ejecución del control.

Plan/evidencia: `docs/superpowers/plans/2026-10-07-team-ux-context.md`, ledger S03 y `.uvh-runtime/o67-team-ux/verify.py`. **Global/S01–S13 abiertos**: administración/estado público, AuthService/frontendauth, sesiones con vista abierta/Centro, despacho bajo TX exterior/CSV, S13/release y demás gates. S03 no se cierra con este lote. Sin DB/cuentas/mail/providers/migraciones/worker/control compartido/agentes/worktree/commit/push/deploy.
