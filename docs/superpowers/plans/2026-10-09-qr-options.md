# O88 — Personalización de QR con vista previa coherente

Petición: redundancia, checkbox de logo UVH activado por defecto y opciones útiles con presentación profesional. Aplicar inline sobre O87; no eliminar resolución ni otras funciones. Sin DB/proveedores/deploy/control scripts. No modificar producto mientras procesos propios de verificación estén activos.

Diseño: misma Manrope, fondo/superficie UVH, tinta #262821, blanco del QR y acento coral del panel. Modal760px con preview a la izquierda y configuración a la derecha, apilado móvil. Una zona de marca con checkbox y explicación, campos de redundancia/margen/resolución, acción principal descarga y restablecer discretamente. QR protagonista, controles alineados, mensajes de progreso ligados a acción y reduced-motion.

Contrato: logo true, corrección H, margen4 y PNG2048 por defecto. Sin logo: QR completo negro/blanco con L/M/Q/H. Logo impone H en UI y renderer. Márgenes4/6/8 módulos, sin permitir quitar quiet zone. Vista previa480 refleja logo/corrección/margen; resolución cambia sólo export. Descarga captura opciones, bloquea cambios durante preparación y evita trabajo/descarga después de cierre. Preview con generación/context guard, error controlado y sin descarga de preview obsoleta. MFA conserva marca/H/defaults.

- [x] Implementar opciones tipadas renderer, controles y layout responsive; defaults equivalentes O87.
- [x] Pruebas de logo/corrección/margen, preview obsoleta/pending/cierre/fallo y opciones de export coherentes. Mantener nombre seguro/import diferido/funciones MFA.
- [x] Suite completa/build/lint/tipos/diff y QA PNG reales con/sin marca, cuatro niveles, márgenes y resoluciones; teclado, dos temas, móvil/escritorio, errores/reintento/contexto.
- [x] Revisar capturas, hashes y procesos cerrados, documentar resultados/límites y pendientes globales.

## Evidencia final

9 pruebas nuevas;1.870 completas con versión final/build/lint/tipos/diff0.73 casos/1.603 checks de navegador;68 PNG descargados y leídos del build actual, incluidos24 sin logo con los cuatro niveles y44 con marca/resoluciones/margen. Dos temas/tres anchuras, teclado/restablecer/import/cierre/error/reintento y MFA conservados; axe seleccionado sin serious/critical. Default PNG480 sigue byte-equivalente al baseline previo.

Decoder independiente90/90 sobre tres longitudes de URL,480/2048,marca/H y clásico/L/M/Q/H,márgenes4/6/8. Antes del arreglo de proporción hubo2 fallos nativos con logo/margen8; mismo matrix verde tras ajustar el sello al área real de módulos. No tapar el agujero de marca cuando se desactiva: clásico coincide con PNG estándar en cuatro pruebas de bytes.

Capturas desktop con/sin logo y mobile claro/oscuro inspeccionadas. Escritorio633px: control resolución termina477.6px y footer empieza517.6px. Móvil conserva acciones fijas y scroll dentro del contenido.391 hashes fuente/138 build intactos; procesos propios terminales.

Coste raw autorizado por nueva función:7.080/7.093bytes de cierre estático Links/Detail, Settings sin delta; engine sigue diferido con26.565bytes(+296). Margen4 mantiene el camino original; sólo márgenes ampliados con marca calculan módulos con API pública adicional para evitar tapar más datos. Sin promesas de mejora global de latencia. Límites de remuestreo extremo O86 conservados; no universalizar lectura física. Evidencia runtime O88/verification-summary.json. No deploy/DB/proveedores ni cierre global.

Revalidación de la petición QR: lectura del contrato y fuentes actuales, 75 pruebas dirigidas de renderer/servicio/modal/MFA, todas correctas; proceso terminal exit0. Registro `.uvh-runtime/o88-qr-options/recheck-latest-request.log`. No se han añadido cambios redundantes al producto.
