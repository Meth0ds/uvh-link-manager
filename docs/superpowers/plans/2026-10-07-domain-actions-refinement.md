# O68-D — Acciones de dominios personalizados

Prioridad expresamente indicada por el usuario: botones de desactivar/revalidar apretados y sin organización. Se conserva la revisión global activa; O68 administración tiene 24 reproducciones nativas pendientes de corrección, no se presenta como verde. Sin agentes, control compartido, DB real o proveedores.

Dirección: conservar Manrope y tokens UVH (papel #fffcf5, tinta #262821, acento #b53c20; oscuro #2c3028 / #f79573). Navegación visible; mantenimiento en filas con propósito, botón alineado y mínimo 44px. DNS y preferencias neutrales; disponibilidad y eliminación separadas con consecuencias. Resumen expandible reconocible y accesible por teclado. Responsive por ancho real del contenedor. En detalle, separar comprobación y preparación HTTPS y dar espacio al guardado.

Crítica: no convertir cada botón en tarjeta ni añadir contadores ficticios. Preservar handlers, permisos, confirmaciones, estados DNS/TLS, idempotencia y navegación existente. No introducir más lógica para un ajuste visual reversible.

- [x] Leer vistas y estilos completos de lista/detalle, specs antiguos relacionados y contratos de UI. Respaldar las cuatro fuentes.
- [x] Captura actual con API aislada y contrastar agrupación/espaciado.
- [x] Aplicar composición y estados visuales.
- [x] Specs de dominios/integraciones, tipos, lint y build.
- [x] QA del build real: roles, móvil/escritorio, claro/oscuro, acciones por teclado y cancelación.
- [x] Documentar alcance, evidencia y pendientes globales.

Resultado: cuatro fuentes de vista/estilo;119 specs anteriores intactos,829/833 fuentes indexadas previas sin cambios; el archivo adicional de reproducciones de administración sigue pendiente (834 hashes actuales). Navegación neutra, mantenimiento en filas con botón alineado de220px en escritorio, separación32px texto/botón y16px vertical en móvil; área de disponibilidad/eliminación separada con consecuencias. Resumen nativo con chevron, foco e identidad accesible. Editor no recibe sección vacía mientras HTTPS se prepara. Detalle conserva comprobación/HTTPS con botones de ancho completo en móvil y explicación de bloqueo fuera de la etiqueta del botón.

Verificación:36/36 pruebas nativas de dominios e integraciones;types/lint/build terminal0. QA49 estados del build real con API ficticia loopback8497: cuatro roles,1440/1024/768/390/320px y ambos temas; adicionalmente cancelación de desactivar por teclado sin POST y navegación a diagnóstico. Sin overflow horizontal, controles≥44px, gaps medidos y cero comandos API. Capturas de lista escritorio/móvil/320 y diagnóstico inspeccionadas visualmente. No test nuevo para un cambio visual reversible.

Evidencia/comparador: `.uvh-runtime/o68-domain-actions/verify.py`, manifests y capturas locales. No se ejecutó ni modificó control compartido, backend/DB/mail/DNS/TLS/proveedores reales; tampoco agentes/commit/push/deploy. Preparación inicial de qa.py falló por cwdfrontend y fue corregida; no era fallo de producto. Lint inicial detectó un import de tipo sin uso en el nuevo spec de administración y se corrigió, conservando sus24 expectativas fallidas. No se declara suite global verde, administración resuelta ni perfección global.
