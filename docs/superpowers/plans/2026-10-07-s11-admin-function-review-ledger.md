# Registro parcial S11/S13 — O68, administración (07/10/2026)

Lectura completa de PanelComponent TS/HTML/SCSS y del código de la consola y sus tres colas completa, con HTML/SCSS; QueuePaging y nuevo AdminViewContext completos. No certifica S11/S13 completos. Callbacks leídos dentro de sus funciones/configuraciones; inventario estático no sustituye revisión. 34 casos nativos nuevos; 30 rojos válidos. Un rojo anterior de heartbeat era un defecto del fixture Material: se corrigió con provideNoopAnimations y se demostró después el fallo real revirtiendo únicamente el rótulo. Los cuatro specs previos adaptan contexto autenticado; el padre también adapta selectores/orden de secciones al rediseño, conservando los 30 casos anteriores.

Menú principal compacto de76px sólo en administración, con expansión por puntero/foco sin reflujo y fijación explícita. Drawer habitual en móvil. Tres controles nativos adicionales; no se atribuyen rojos históricos a estas mejoras visuales.

Navegación final solicitada: lateral por Cuentas, Revisión y cumplimiento y Plataforma, contenido propio a la derecha; selector agrupado en contenedores ≤900px. @switch sustituye MatTabs y mantiene montaje lazy de moderación. Resumen nativo desplegable; datos secundarios no desplazan la cola. Acciones de denuncia, bloqueo global y ampliación de plazo separadas. QA usa build real y API ficticia loopback, sin proxy/DB/comandos reales.

## frontend/src/app/panel/admin/admin.component.ts

SHA-256: `fe6f828c8c333fbc552146798c5a2d749179194d813b845c4829758e60106155`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `onSectionKeydown` | 123 | Navegación lateral con activación manual: flechas/Home/End mueven foco, Enter/Espacio del botón nativo seleccionan. QA de teclado; sin nuevo caso nativo dedicado. |
| `healthLabel` | 317 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `constructor` | 357 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `resetView` | 371 | Limpia snapshots, colas, filtros, selección y flags de la sesión anterior. B230/B231/B233. |
| `start` | 401 | Cola inicial independiente de snapshots; otros grupos permanecen lazy. B234 y caso de overview pendiente/fallido. |
| `queueForTab` | 410 | Secciones conservan índices estables aunque cambie orden visual. Moderación crea sus tres colas sólo al seleccionarse. |
| `openTab` | 419 | Navegación lateral/selector/atajos llaman al mismo controlador; carga inicial por sección una vez. Cambios de sesión devuelven a Usuarios. |
| `reloadAll` | 427 | Excepción explícita a lazy: recarga siete colas y snapshots; revisión de moderación independiente. Final ligado a clave viva. |
| `searchRecoveries` | 450 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `filterRecoveries` | 455 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `approveRecovery` | 460 | B230/B231: intención capturada antes de confirmación, cola confirmada, exclusión con propietario; backend conserva doble aprobación. |
| `rejectRecovery` | 473 | B230/B231: mismo límite de intención/cola y confirmación con consecuencias explícitas. |
| `decideRecovery` | 486 | B231: propiedad de slot, resultado/feedback/recargas sólo del contexto vigente. Payload/decode conservados. |
| `loadOverview` | 511 | B231/B234: contexto vivo, GET cancelable, error y carga propios; retry sólo del resumen. Último dato se identifica como tal. |
| `searchUsers` | 528 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `searchPendingRegistrations` | 533 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `filterUsers` | 538 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `isAdminUser` | 543 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `hasMfa` | 547 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `toggleAdmin` | 551 | B230/B231: guard de contexto y cola antes/después del diálogo; propiedad, error/feedback/recargas. Identidad accesible de la cuenta. |
| `toggleBlock` | 581 | B230/B231: captura previa; no despacha bajo otra sesión, no publica finales anteriores. Backend mantiene locks/revocaciones. |
| `onModerationChanged` | 619 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `refreshModeration` | 630 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `searchDomains` | 635 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `filterDomains` | 640 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `searchAudit` | 645 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `loadOperations` | 650 | B231/B235: respuesta/errores/finales de clave actual. Vista distingue lectura vigente de última lectura y ausencia de respuesta. |
| `filterMail` | 667 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `retryMail` | 672 | B230/B231/B232: vuelve a excluir concurrencia después del diálogo mediante begin; resultado actual y recarga propia tras error. Caso positivo conservado. |
| `filterPrivacyStatus` | 699 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `filterPrivacyType` | 704 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `startPrivacyReview` | 709 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `requestPrivacyInformation` | 713 | B230/B231: intención previa al prompt y runner vuelve a exigir cola confirmada. |
| `completePrivacy` | 720 | B230/B231: igual captura previa al prompt; publicación sólo por propietario actual. |
| `rejectPrivacy` | 727 | B230/B231: respuesta motivada capturada, guard de sesión/vista y propiedad. |
| `extendPrivacy` | 734 | B230/B231: captura previa; código de motivo/payload conservados y verificación posterior. |
| `privacyMessage` | 741 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `runPrivacyAction` | 756 | B230/B231: cola/propietario y protección de resultado/feedback/follow-ups. Backend decide transición y permisos bajo TX. |
| `count` | 773 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `auditLabel` | 783 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `resourceLabel` | 788 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `environmentLabel` | 793 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `ageLabel` | 797 | B236: ausencia configurable; Worker/Scheduler dicen Sin señal, espera de cola vacía conserva Sin espera. Reproducción roja válida con plantilla real y animaciones noop. |
| `showError` | 804 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |

## frontend/src/app/panel/admin/admin-reports.component.ts

SHA-256: `fe6010247e98b0a8e35ffc1fd5720feea5a558149abc0e90217953257f18f9e9`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 90 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `search` | 106 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `filter` | 111 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `review` | 116 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `dismiss` | 120 | B230/B231: confirmación capturada y runner privado recibe intención original. |
| `block` | 132 | B230/B231: motivo capturado, contexto previo y runner actual; UI separa enlace de bloqueo global. |
| `unblock` | 150 | B230/B231: confirmación ligada a vista/sesión original. |
| `blockDestination` | 170 | B230/B231: alcance URL/host explícito, contexto previo; no eventos tardíos. Backend conserva política de destinos y barrido. |
| `sweepLabel` | 213 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `hostOf` | 223 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `moderate` | 232 | B231: cola confirmada, slot propio, feedback/evento de identidad vigente. Padre centraliza recargas. |
| `showError` | 255 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |

## frontend/src/app/panel/admin/admin-appeals.component.ts

SHA-256: `226664efdbc077728a12f8a5440acebe797bdd725ec3c8d11f4a17fa40fcb7bc`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 81 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `filter` | 97 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `resolve` | 110 | B230/B231: nota opcional admite vacío pero no cancelación; contexto previo y slot propietario; no eventos/finales anteriores. |

## frontend/src/app/panel/admin/admin-destinations.component.ts

SHA-256: `96f650dddbc629f8c3c495d1a1fd7aab0bbe3f98c35a45a078bda16ffba41005`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 83 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `withdraw` | 109 | B230/B231: retirada con consecuencias, cola vigente y contexto anterior al diálogo. Final/evento sólo por dueño; sin GET duplicado. |

## frontend/src/app/panel/admin/admin-view-context.ts

SHA-256: `f7eab727947c971058db23344194e3eb5756cd36690cc1618938a6af92adf6bb`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 23 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `capture` | 41 | Captura anterior al diálogo; comprueba vista viva, proyección elegible, contexto renderizado y clave actual antes incluso de ejecutarse el efecto. B230. |
| `begin` | 48 | Propietario de comando por vista reutiliza OwnedMutations. Su final sólo libera su propio slot. B231/B232; no aborta comandos admitidos ni sustituye autorización backend. |

## frontend/src/app/core/queue-paging.ts

SHA-256: `aaef17cccc090c9222fd7a7013e322db3481270e1fca0feba19986e5b030b787`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `constructor` | 62 | Contexto de sesión y vista; reset de lecturas/comandos al cambiar identidad/rol/MFA. Efectos y callbacks leídos dentro de su dueño. Casos de cambio de generación/destrucción y respuestas tardías. |
| `load` | 69 | B233: pregunta viva de filtros/página/tamaño/contexto. Read abortable y respuesta/errores/finales condicionados a la identidad actual; deshabilitación resetea datos. |
| `question` | 96 | B233: identidad incluye contexto, filtros, página y tamaño, consultados en vivo. |
| `reset` | 101 | Invalida GETs; borra filas, total, error y página del contexto anterior. Conserva tamaño elegido. |
| `restart` | 115 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |
| `goTo` | 121 | Lectura en contexto; vocabulario/payload/paginación preservados. Casos previos y controles dirigidos conservados; sin nuevo test dedicado para cada función ni garantía global de ausencia de bugs. |

## frontend/src/app/panel/panel.component.ts

SHA-256: `04c8f84387f6e93cc9d0a377ee3bd94913989b6ec642f4e8d1e89961348adc1b`.

| Función | Línea actual | Evidencia / límite |
| --- | --- | --- |
| `roleLabelFor` | 86 | Vocabulario de roles y fallback conservados. Lectura sin nuevo caso dedicado. |
| `onMainNavFocusOut` | 113 | El foco entre enlaces mantiene la expansión; salir de la navegación la cierra salvo hover o fijación. Tres casos nativos del menú principal y QA de foco/puntero/fijación/móvil. Sin persistencia de preferencia entre montajes. |
| `constructor` | 127 | Lectura completa: refresca contador de avisos; un fallo silencioso conserva el dato. Comportamiento previo sin cambios. |
| `onWorkspaceChange` | 185 | Delega selección de workspace; permiso/aislamiento residen en servicios/backend. Sin cambios. |
| `skipToContent` | 189 | Evita navegar por el fragmento y enfoca el contenido de la ruta actual. Lectura; controles previos conservados. |
| `newLink` | 197 | Conserva guard de creación por rol y navegación tras diálogo; no duplica acción contextual del dashboard/lista. Cinco casos previos de creación intactos. |
| `createWorkspace` | 204 | Conserva diálogo, recarga de workspaces y selección del resultado; no amplía permisos. Dependencias pendientes del ledger global. |
| `logout` | 217 | Exclusión de cierre, navegación sólo tras logout confirmado y feedback tras fallo. Código previo sin cambios; no atribuir arreglos O68 a esta función. |

## Contratos backend conciliados

AdminController: overview, updateUser, moderateReport, accountRecoveries, decideAccountRecovery, domains/domainInspectorRow, audit, operations, mailOutbox/retryMailOutbox, resolveAppeal, blockDestination, denylist/removeDenylistEntry, pagination, lockEligibleAdmin/eligibleLockedAdminSession, positiveInteger, heartbeatAge y operationCheck leídos completos de forma acumulada. PrivacyRightsController adminIndex/adminAction, rutas administrativas y MfaFreshness completos. Los cuerpos parciales adicionales no se contabilizan como revisión completa. No acredita todas las dependencias/locks/jobs ni una ejecución de SQL: se conserva como pendiente de S11. Los comandos vuelven a comprobar actor/sesión/MFA dentro de transacción; los fallos corregidos aquí son captura de intención, publicación/lecturas de UI y presentación, no una prueba de bypass backend.

Decodificadores administrativos/privacidad y de estado de MFA leídos para validar contratos de la API ficticia; no modificados. Cache PHP del inventario revalidada por los 241 hashes antes de regenerar AST TS/superficies. Migraciones, infraestructura, proveedores, publicación, broker y E2E reales no tienen un gate nuevo en este lote.

B237: conteo, vacío y paginador no describen una pregunta sin respuesta vigente; QueueSection conserva aviso/retry y contexto de filas antiguas, bloqueadas para decisiones. Los textos nuevos no certifican lector de pantalla real; controles/semántica/foco se verifican en DOM y navegador.

La pasada es progreso acotado. S11, S13 y el objetivo global S01–S13 permanecen abiertos. AuthService/auth frontend, Centro/sesiones abiertas, estado público, despacho bajo TX exterior/CSV y release conservan trabajo pendiente.
