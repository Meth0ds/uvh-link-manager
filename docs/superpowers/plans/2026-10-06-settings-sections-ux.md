# O64 — Ajustes por secciones y sesiones legibles

Continuación del objetivo completo S01–S13; O63 verificado por comparador antes de empezar. Fuente completa SettingsTS1247/HTML459/SCSS978, SecurityCenterTS y rutas leídas. Sin agentes/control compartido/DB real/migraciones/mail/provider/commit/publicación.

Diseño: conservar marca (Manrope, papel#fffcf5,tinta#262821,acento#b53c20,oscuro#2c3028/acento#f79573). Navegación de cinco vistas con enlaces canónicos y aria-current, una sección visible; otras siguen montadas/hidden, nunca @if de sección. Perfil compacto, navegación14px/ayuda13px, texto funcional13–14px. Borradores/MFA/códigos de un uso y operaciones mantienen la misma instancia. Saltos internos revelan el destino antes del foco. Abrir en otra pestaña conserva navegación nativa; clic normal mantiene replaceState sin recargar como el contrato actual.

Crítica: cinco vistas responden a tareas distintas; no numeración ni nuevas tarjetas decorativas. No fingir un tracker de scroll si sólo hay una vista. Unificar nombres humanos de navegador/sistema, cadena técnica en details; user-agent es descriptivo, no prueba de identidad. Backend sigue autoridad. No extraer lógica de credenciales durante este cambio visual.

- [x] Estado/plan y fuentes completas; snapshot de822 fuentes previas.
- [x] Reproducir respuesta de sesiones que caduca durante la espera y error de impacto sin recuperación persistente. BugIDs sólo tras rojo nativo válido.
- [x] Vistas persistentes, foco/enlaces reales, sesiones humanas compartidas y recuperación de lectura de cierre de cuenta.
- [x] Controles de borradores, secretos, navegación modificada, rutas, foco, errores, lectura tardía e identidad; sin editar specs existentes; se conserva el ajuste concurrente de fixture de exportación.
- [x] Build real + QA aislada escritorio/móvil/temas/teclado; suites/tipos/lint/build finales.
- [x] Hashes/inventario/ledgers/documentación ycleanup propios. S01–S13 permanecen activos.

Pendiente fuera de este lote: caducidad de sesión mientras vista abierta, relojes/autoridad de otros consumidores, despacho auxiliar bajo TX exterior/CSV,AuthService/frontendauth,S13 yrelease externo. El Centro de seguridad sólo comparte presentación de UA; revocación/carreras propias requieren revisión independiente.

## Evidencia y límites

B211/P2: dos rojos de respuesta tardía/límite exacto; B212/P2: un rojo de error persistente. Rojo válido3fallos/1control (`recovery-red-settled.log`); errores previos de preparación/compilación conservados y no contabilizados como bugs. 17 casos nuevos,105 dirigidos antes del último caso accesible y41 de recuperación/exportación actuales. Primera suite completa3fallos/1487correctos: foco de exportación buscado en la vista oculta del perfil. Se conserva un cambio concurrente en el fixture de esa prueba para entrar por privacy; las expectativas de foco/GET/idempotencia permanecen. Suite actual1490/1490.

QA del build real con fixture8466:44 observaciones, cinco vistas,1440/390/320px, ambos temas, navegación por teclado, borrador conservado, rutas directas y503→GET recuperado; cero mutaciones. Un clic CLI no cambió vista y su espera terminó por timeout: acciones conservadas, matriz repetida mediante foco+Enter nativos; no se atribuye bug de producto sin reproducción. Pulido final del foco de título verificado con build de entrega10,534s,1490/1490 nativos y siete observaciones adicionales.

Cinco fuentes previas ajenas modificadas o borradas concurrentemente (control compartido, su test/dashboard, SecurityScanContractTest y fixture de exportación), además de cinco scripts nuevos ajenos; se registran por separado. No afirmar que los822 hashes históricos siguen iguales ni reescribir manifests O63. El control no se ejecuta, prueba, construye ni lanza. Inventario es enumeración estática; nuevos scripts compartidos y CJS no acreditan revisión S13.

Resultado de entrega:1490/1490, tipos/lint/build terminal0;829 hashes,811 fuentes previas ajenas y112 specs íntegros,1fixture concurrente registrado. Inventario501/2369named/1271anonymous/3firmas/0provisional; S01 388anchors/86archivos,S02 205/32,S10 63/9. Comparador `verify.py` confirma transformaciones exactas y33 puntos del informe. Sólo el lote local queda cerrado; objetivo yS01–S13 continúan activos. Cleanup de browser y fixture propios registrado en terminal-results.
