# O68 — administración: contexto, lecturas independientes y diseño

O67 revalidado con su verificador: progreso real,1565frontend/32estados y833hashes actuales. Objetivo global S01–S13 abierto. No procesos nativos/build/browser/server previos vivos. Control/test y panel-api ajenos conservados; nunca ejecutar el control compartido.

## Lectura y riesgos a reproducir

AdminComponent completo y tres componentes de moderación leídos; QueuePaging y SessionContextService completos. HTML/SCSS se leen en tramos porque una salida conjunta se truncó; completar esos tramos antes de afirmar revisión completa. QueuePaging sólo tiene10consumidores, todos administración.

Candidatos (sin ID ni afirmación de arreglo): intención tras diálogo se despacha con nueva sesión/vista destruida; respuestas tardías publican feedback/eventos/recargas; retryMail no vuelve a comprobar exclusión; QueuePaging compara contexto capturado consigo mismo; un fallo del overview oculta todas las pestañas; estado operativo fallido se describe con cero trabajos/última salud verde; pulso ausente se llama «Sin espera».

## Dirección visual

Conservar Manrope, tinta #262821, papel #f5f2e9, superficie #fffcf5, acento #b53c20, peligro #b12e30 y tokens oscuros compartidos. Texto funcional14–16px, etiquetas13px; números22–32px respaldados. Colas y decisiones como foco, métricas como apoyo; fallo de un resumen no bloquea otras lecturas. Tablas sólo cuando su contenedor admite todas las columnas, fichas agrupadas en anchuras menores. Datos personales completos, acciones con identidad accesible, controles≥44px y separación≥12px.

Revisión del plan: eliminar decoración editorial de datos operativos y etiquetas diminutas; no añadir nuevas estadísticas ni paneles decorativos. Mantener «desconocido» y «última lectura» distintos de cero/estado confirmado.

## Implementación y gates

1. Completar fuentes/contratos afectados; demostrar fallos con casos nativos reales.
2. Compartir captura de sesión/vista y propietario de comandos en las4superficies; reutilizar OwnedMutations. Ampliar QueuePaging con contexto vivo/reset según consumidores, sin ejecutar solicitudes viejas como nueva identidad.
3. Recuperación independiente y métricas honestas; mejorar composición/tablas/etiquetas.
4. Pruebas específicas/completas, tipos/lint/build; QA aislada fakeAPI1440/390/320/temas y teclado.
5. Conciliar inventario/ledger por función y documentación sin cerrar S11/S13/global por este lote.

Sin DB/cuentas/correo/proveedores/migraciones reales, agentes/worktree/commit/push/deploy.

Prioridad O68-D solicitada durante la revisión: refinamiento visual de acciones de dominios. Administración permanece pendiente: corrida nativa red-first termina con24/24 fallos reproducidos, sin corrección de producto todavía. Se quitó un import de tipo sin uso en el nuevo spec para dejar lint verificable; no se cambiaron expectativas. Lectura adicional completa de HTML/SCSS de las tres colas hijas, moderation-card.scss, QueueSection TS/HTML/SCSS y queue-primitives.scss; relectura sin truncación de CSS padre150–246 y HTML315–358 completa los huecos visuales anteriores. Aún pendientes cuerpos de contrato backend y resto del spec reports. La compilación y QA del refinamiento de dominios no acreditan administración ni el cierre global.

Lectura posterior adicional para administración (sin cambios de código): último tramo del spec reports120–final; AdminController updateUser170–258 parcial, moderateReport417–492 completo (resto de ventana incluye blockLink), retryMailOutbox1191–1258 parcial y resolveAppeal1374–1455 completo. Se confirma que los comandos backend validan nuevamente administrador/MFA/sesión dentro de la transacción, por lo que la reproducción frontend pendiente es captura tardía de la intención y publicación de UI, no una demostración de bypass de autorización backend. Falta leer completos updateUser/retryMailOutbox y demás contratos antes de cerrar el ledger.

## Resultado y ajuste de disposición solicitado por el usuario

Se completaron las lecturas parciales listadas arriba, según ledger parcial.34 casos;30 rojos válidos, corrección del fixture Material distinguida del producto y reproducción real posterior de heartbeat. El usuario pidió sustituir la barra de pestañas: navegación lateral agrupada y zona de contenido, con selector en anchuras menores. @switch mantiene carga lazy de moderación y elimina la dependencia de animación de MatTabs; navegación roving/manual verificada por teclado. Resumen plegable, acciones por alcance y estados de lectura explícitos. Las pruebas antiguas mantienen casos; ajustes de contexto/selectores/orden visual están documentados, no se presentan como fuentes intactas.


O68 (07/10), administración: navegación lateral por Cuentas, Revisión y cumplimiento y Plataforma; contenido independiente y selector agrupado en contenedores estrechos. @switch sustituye MatTabs; resumen desplegable y atajos a moderación/sistema. Menú principal compacto de76px en administración, expansión con ratón/foco sin desplazar contenido, fijación explícita y drawer habitual en móvil. Acciones locales de denuncia separadas de bloqueo global URL/host; privacidad separa gestión, ampliación y cierre. Texto funcional13–16px, campos con etiquetas accesibles y filas adaptadas al espacio real. Se corrigen B230–B237: intención tras diálogo, publicación/finales anteriores, exclusión de retry, pregunta viva de colas, resumen independiente y representación honesta de lecturas/pulsos/conteos.

34 casos nuevos de contexto y3 del menú principal, con30 rojos nativos válidos; un rojo histórico de heartbeat era fixture Material y se reemplazó por reversión controlada del fallo real.1602/1602 frontend,types/lint/build exit0. QA del build/API ficticia: 89 estados, ocho secciones,1440/1024/390/320 y comprobaciones a1920, ambas apariencias; teclado, resumen, fallo/retry503, snapshot pendiente y cancelación de seis decisiones sin comandos. Durante QA se corrigió una regresión CSS del footer de privacidad.21 fuentes de producto;115 specs previas intactas, cuatro adaptan sesión y el padre también selectores/orden semántico; el spec nuevo conserva34 casos.834 fuentes de partida:809 ajenas intactas;836 actuales incluyendo helper y spec del menú principal.

Plan/ledger: `docs/superpowers/plans/2026-10-07-admin-ux-context.md`, `2026-10-07-s11-admin-function-review-ledger.md`; evidencia `.uvh-runtime/o68-admin-ux/verify.py`. Contratos backend leídos, sin edición/backend gate nuevo ni DB/cuentas/mail/providers/migraciones/workers/control compartido/agentes/commit/deploy. S11/S13/global S01–S13 permanecen abiertos; AuthService/auth frontend, Centro/sesiones abiertas, estado público, despacho bajo TX exterior/CSV y release siguen pendientes.
