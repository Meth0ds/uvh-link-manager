# Logo propio en el QR — Implementation Plan

> Ejecución en esta sesión por fases, con comprobaciones antes de cerrar. Preservar los cambios existentes; sin commits ni despliegues.

**Goal:** Descargar QR con logo UVH, logo propio o sin logo, con una interfaz clara y procesamiento local seguro.

**Architecture:** Un preparador aislado valida el archivo PNG/JPEG por firma y dimensiones antes de decodificarlo. Normaliza a un lienzo de hasta 1024 px; el generador diferido dibuja ese lienzo proporcionalmente en una placa blanca de área limitada. El modal controla la propiedad de las cargas y las vistas previas.

**Tech Stack:** Angular, Material, Canvas, createImageBitmap y qrcode existentes; sin dependencias nuevas.

**Spec:** Petición del usuario de logo propio, bien adaptado, intuitivo y seguro. PNG/JPEG hasta 2 MiB y 4096 px por lado; no SVG ni direcciones externas. Procesamiento local sin persistencia. Nivel H obligatorio con cualquier logo, margen mínimo de cuatro módulos, mismas resoluciones y QR clásico. Conservar proporciones y transparencia, sin recortar el contenido. Errores accesibles y cargas obsoletas descartadas; respetar movimiento reducido.

## Fases

- [x] Preparador: `frontend/src/app/core/services/qr-custom-logo.ts` y pruebas reales de formato, límites, dimensiones, transparencia, imagen vacía y liberación del bitmap.
- [x] Generador: ampliar `QrCodeRenderOptions` con lienzo normalizado opcional; aislarlo de las opciones de qrcode; dibujar logo propio en placa blanca con ajuste proporcional y área igual o menor que UVH. Probar PNG, proporciones, protección H y QR clásico.
- [x] Modal: selector UVH/propio junto al checkbox existente, carga mediante botón accesible, miniatura/nombre/cambiar/quitar, errores y estado de carga independientes. Un contador invalida cargas al cambiar, quitar, restablecer o destruir. Deshabilitar exportación durante carga o mientras falte el logo elegido. Mantener opciones actuales.
- [x] Verificar pruebas QR, types, lint, build y suite frontend. Revisar modal real en escritorio y móvil usando entorno de diseño aislado, sin acceder a datos de clientes. Registrar resultados y limitaciones.

## Validación

Ejecutar `ng test --watch=false --browsers=ChromeHeadless --include='src/app/**/qr*.spec.ts'` en puerto propio. Después `npm run typecheck`, `npm run lint`, `npm run build` y suite completa. Casos obligatorios: archivo falso con MIME PNG, SVG, archivos excesivos/dimensiones excesivas antes de decoder, PNG/JPEG reales, aspecto horizontal/vertical, ausencia de logo, carga antigua tras nueva/reset/cierre, error que conserva logo anterior, vista/exportación con el mismo logo. No afirmar compatibilidad universal de escaneo por el nivel de redundancia: verificar QR representativos con lector real disponible y aconsejar prueba antes de imprimir.

## Resultado verificado — 10 de octubre

- 55/55 pruebas QR y 2077/2077 de la suite frontend; types, ESLint, build de producción y `git diff --check` con salida 0. Sin dependencias nuevas en la aplicación.
- Escritorio 1280×900, móvil 390×844 y ancho 320 px sin desbordamiento horizontal. Capturas y estados en `.uvh-runtime/custom-qr-logo/`; la imagen anterior sobrevive a una sustitución SVG inválida. Mantener desplazamiento del contenido y acciones de descarga/cierre visibles.
- ZXing 3.1.1 instalado solamente en el directorio de QA: 135/135 PNG decodificados a su URL exacta. Tres logos (horizontal/vertical/cuadrado), tres URLs de longitud distinta, cinco resoluciones (480 de preview y cuatro de exportación), márgenes 4/6/8. No sustituye las pruebas de impresión y dispositivos reales indicadas en el modal.
- Corrección adicional encontrada en los PNG: `qrcode` puede redondear 512 a 511 px para un número de módulos determinado. Se añade papel blanco cuando falta exactamente un píxel, conservando los módulos originales, sin reescalado. Prueba de dimensiones de las quince combinaciones resolución/margen y comparación de píxeles del QR clásico.
- Procesamiento exclusivamente local: firma y dimensiones antes del decoder, límite 2 MiB/4096 px, raster normalizado a 1024 px, transparencia recortada sin cortar el dibujo, bitmap liberado incluso al fallar, nombres sin caracteres de control/direccionales. Placa proporcional hasta el área máxima existente, redundancia H y margen mínimo cuatro módulos.
- Cargas obsoletas invalidadas al sustituir, quitar, cambiar a UVH, desactivar, restablecer o cerrar; descarga bloqueada durante carga o si falta el logo elegido. No se guarda el logo entre aperturas.
- Inventario regenerado: 528 archivos, 2553 funciones nombradas, 1397 anónimas, 3 firmas, cero archivos provisionales. Enumeración no equivale a revisión completa del proyecto.

La optimización global permanece activa; este documento cierra la petición adicional de logo propio. La suite backend anterior terminó con un fallo del contrato Dependabot por dos Dockerfiles sin entrada y una omisión DNS; no se considera verde ni se atribuye al QR.
