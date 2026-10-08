# O70 — Vigencia de lecturas de seguridad y entrega de recuperación

08/10/2026. Alcance parcial S01/S13; no completa la auditoría global S01–S13.

1. Revisar consumidores de sesiones montados, flags de MFA, Auth facade y contratos backend. Conservar la separación entre estado de UI y autorización del servidor.
2. Reproducir caducidad exacta, pestaña suspendida, reemplazo/destrucción, ACK de MFA frente a lecturas previas y mensajes de disponibilidad de códigos con entrega incierta. Nuevos controles sobre el transporte real simulado y templates reales antes de editar producto.
3. Compartir un temporizador de deadline de lectura, con zona Angular/lifetime/foco/visibilidad, chunks del límite nativo y una sola actualización al vencer. Sin sondeo periódico ni logout por reloj del cliente. Parar/reemplazar timers al iniciar un refresco o cambiar cuenta.
4. Corregir Centro y Ajustes: no acciones con filas caducadas o lector pendiente, claves vivas de cuenta, lecturas MFA anteriores invalidadas y recuperación sin afirmar entrega utilizable. Recuperar datos de cuenta sin repetir writes.
5. Comprobar deadline/helper, casos rojos/verdes, suite frontend completa, lint/tipos/build, QA de build con API ficticia y hashes. Registrar pruebas y pendientes reales; no DB/cuentas/mail/proveedores/worker/control compartido/panel ajeno/commit/despliegue/agentes.

Partida:837 fuentes; únicas diferencias contra O69 son los cuatro archivos del menú principal del turno solicitado, verificados por separado. O69 histórico permanece congelado.


## O70 — Comodidad, transiciones y vigencia de lecturas (08/10/2026)

Movimiento: entrada única de página (300ms, 8px), sección de Ajustes (220ms, 5px), expansión del menú (240ms), etiquetas con aparición diferida y fijación con reserva animada (220ms). Feedback de pulsación en toolbar. Movimiento reducido desactiva estos efectos; no se añade una transición nativa de router. La navegación a otra página restablece el scroll de main; query/hash de la misma página lo conservan. Es una garantía UX añadida: el navegador anterior ya reseteaba Settings→Centro por la reducción de contenido del skeleton (730→0), por lo que no se atribuye un bug histórico a esa ruta.

B244–B247/P2 corregidos con 12 rojos nativos válidos: sesiones que seguían vigentes visualmente después del deadline; lectura de Ajustes de una identidad anterior sin cambio de generación; Centro que ignoraba el estado de proyección pendiente tras MFA; y códigos descritos como disponibles pese a entrega incierta. ReadDeadline comparte una única actualización al vencer, pausa en pestaña oculta, reevalúa foco/visibilidad/reloj y cancela por refresco/contexto/destrucción. El cliente no cierra sesión por su reloj: sólo la respuesta del servidor invalida identidad. Centro ofrece actualización explícita de cuenta sin repetir comandos; /me no recupera códigos write-only perdidos. Refrescos conservan filas visibles y bloquean decisiones mientras leen.

31 casos nuevos (22 consumidor/8 helper/1 scroll), 1661/1661 frontend y build/lint/tipos con salida 0. El nuevo contrato de scroll aporta un rojo adicional separado de los 12 rojos de fallos históricos. Dos suites previas sólo incorporan los tres signals reales en sus dobles, con cuerpos/expectativas intactos; menú conserva sus tres controles y añade uno. 119 specs anteriores intactos. 837 fuentes de partida, 823 previas sin cambios y 840 actuales. PHP:241 hashes intactos; sin nuevo gate backend. Inventario estático503 archivos/2423 funciones con nombre/1313 anónimas/3 firmas/0 owner provisional; enumeración no equivale a revisión.

QA del build/API ficticia loopback8541:36 estados, Centro/Ajustes a1440/1024/768/390/320 en ambos temas, refresco retenido/recuperado, caducidad, entrega incierta, movimiento reducido, hover/fijación y scroll. Sin overflow global/área principal; controles completamente visibles de main≥44px. Un único comando ficticio de regeneración devuelve deliberadamente DTO inválido; no cuenta/DB/correo/proveedor real. La primera comprobación de animationName ignoró el prefijo de encapsulación Angular: se corrigió el harness, no CSS de producto. El primer comparador de specs olvidó retirar el nuevo import signal de la segunda suite; corregido sin tocar expectativas. Intentos de harness preservados/separados de bugs de producto.

Plan y ledger: docs/superpowers/plans/2026-10-08-account-read-lifetime.md y2026-10-08-s01-s13-account-read-function-review-ledger.md. Evidencia/manifests: .uvh-runtime/o70-account-read-lifetime/verify.py. Históricos no reescritos. No ejecución/edición del control compartido, panel ajeno, agentes, migraciones, workers, commit o despliegue.

Objetivo global yS01–S13 siguen abiertos. Continuar frontend cómodo/detallado, formulario de tokens API, Auth/frontend público, estado público, despacho bajo TX exterior/CSV y operación/CI/release real. La QA local no acredita Firefox, lector de pantalla, proveedores ni producción.
