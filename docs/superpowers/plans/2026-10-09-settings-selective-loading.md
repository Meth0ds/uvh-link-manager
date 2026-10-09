# Ajustes: carga selectiva sin pérdida de estado

Lote O84 del plan global de optimización. Ejecución inline, sin agentes, commit, despliegue, launcher compartido ni datos reales. No editar producto mientras estén vivos tests/build/QA propios.

## Contrato leído y decisión

La apertura actual inicia seis GET: sesiones, exportación, historial, baja, privacidad y preferencias. Perfil usa la identidad ya cargada. Mantener una lectura global de estado de exportación, porque inicia la observación automática de trabajos pendientes; no cambiar polling/foco/vencimiento ni historial actualizado al cambiar el estado. Esta decisión conserva un comportamiento existente y limita el objetivo de este lote a eliminar las otras cinco lecturas iniciales cuando no se necesitan.

Primera activación por actor/generación: Seguridad→sesiones; Avisos→preferencias; Privacidad→historial y expedientes; Cierre→impacto. Perfil no añade otra consulta. Guard de sección inicializada antes de iniciar lecturas evita duplicación entre constructor, afterViewInit y saltos rápidos. Se conserva una proyección por vida de vista como hasta ahora, con reintentos explícitos y refrescos tras mutaciones. El guard no representa autorización ni una caché global.

Las cinco secciones permanecen montadas: formularios, borradores, secretos MFA, códigos y overlays no se desmontan al saltar. Actor/generación cambiados limpian el guard junto con los datos, abortan lecturas obsoletas y cargan sólo la sección visible del nuevo actor más observación de exportación. Una mutación enviada continúa bajo los guards existentes; no se repite ni se presenta como abortada en el servidor.

## Ejecución

- [x] Añadir prueba HTTP real de Perfil y cada ruta directa, saltos/coalescing, modified-click, identidad/anónimo/destroy, reintento y seguimiento de exportación. Ejecutar red antes del producto.
- [x] Sustituir carga indiscriminada por observación global + activación por sección; limpiar guard al salir del actor.
- [x] Adaptar sólo el setup de las regresiones existentes que necesitan visitar todas las secciones; conservar sus aserciones de seguridad/resultado. Registrar diferencias.
- [x] Verificar suite completa/build/lint/tipos. Congelar fuentes/build; QA fake API por ruta, ambos temas, 1440/390/320, salto/borradores/carga/error/retry/export en segundo plano. Medir requests equivalentes antes/después.
- [x] Inspeccionar capturas, teclado/axe seleccionado; cerrar procesos, verificar hashes y registrar resultado y límites en plan global.

Criterio: Perfil 6→1 lecturas de Ajustes en arranque estable, otras rutas sólo necesitan estado global y sus datos. Después de visitar todas las secciones, siguen disponibles las seis proyecciones. Un cambio de estado de exportación puede iniciar historial como antes; no prometer cero tráfico de background ni una ganancia global de latencia.

## Resultado verificado

Doce pruebas nuevas con transporte HTTP real en memoria:12 fallos por el contrato de carga anterior antes del cambio, verdes después.115 pruebas dirigidas,1.840/1.840 de la suite completa, build/lint/tipos/diff0. Los fixtures existentes de propiedad, MFA, exportación, avisos y expiración ahora abren las secciones que ejercitan; se conservan sus aserciones de seguridad, y dos pruebas de revocación comprueban además que la operación realmente se inició.

Navegador de builds congelados:42 casos/348 checks para comparación de peticiones, rutas directas, vuelta mientras espera, reintento, borradores y exportación en otra sección. El perfil anterior hace6 GET propios de Ajustes; el nuevo hace1. Seguridad2, Avisos2, Datos3 y Cierre2 incluyendo observación de exportación. Tras visitar todas las secciones siguen existiendo las seis proyecciones; un cambio de exportación refresca el historial como antes. Se repiten48 casos/514 checks de admisión/respuesta/cancelación de privacidad, manteniendo el recibo y los borradores ante errores. Total90 casos/862 checks, ambos temas,1440/390/320px, táctil/reduced-motion y axe seleccionado. Sin errores de página/rutas desconocidas.

Diagnóstico de un aviso de contraste: la primera medición durante interacción informó colores intermedios; cuatro auditorías independientes en las versiones anterior/nueva y ambos temas con vista estable no reprodujeron el fallo. Se espera tema, fuentes y fin de animaciones de toda la vista en el harness; no se cambia el producto ni se certifica accesibilidad integral. Intentos iniciales conservados.

Capturas Perfil móvil claro, Datos móvil oscuro y Seguridad escritorio oscuro inspeccionadas. Navegación nativa por Enter conserva borrador al volver y sólo registra estado de exportación/sesiones. Freeze384 fuentes y136 archivos de build idénticos después de QA;10 archivos legales publicados preservados. Todos los procesos/navegadores propios cerrados; fixture exit130 intencional. Evidencia `.uvh-runtime/o84-settings-loading/verification-summary.json`.

Sólo este lote de carga queda completo. Plan global y baselines/backend/SQL/jobs restantes siguen activos.
