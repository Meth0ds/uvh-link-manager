# O87 — Selector de resolución de descarga QR

Steering del usuario sobre O86: elegir mayor o menor resolución. Implementar inline; ninguna operación en DB/proveedores ni despliegue. Baseline propia O86 guardada. No editar producto durante procesos propios de verificación.

- [x] Campo Material etiquetado, acorde al panel: 512/1024/2048/4096px, 2048 por defecto. Describir uso digital/impresión sin prometer legibilidad física universal.
- [x] Capturar tamaño al admitir descarga; restringir opciones y bloquear cambios durante preparación. No renderizar al cambiar selección. Mantener preview480, cierre/doble acción/reintento/nombre seguro y MFA480.
- [x] Verificar tamaños reales PNG, lectura exacta, teclado, dos temas/tres anchuras; estado busy/error/reintento/foco. Pruebas completas, build, lint/tipos/diff.
- [x] Capturas, hashes, procesos terminales y resultados documentados. Mantener pendientes globales/backend/SQL/jobs y los límites de remuestreo O86.

## Evidencia final

1.861 pruebas completas; build/lint/tipos/diff0.43 casos/1157 checks con builds propios/API ficticia;38 PNG reales leídos exactamente, repartidos por tamaño:{2048: 20, 512: 6, 1024: 6, 4096: 6}. Dos temas/tres anchuras, apertura desde lista/detalle, selección por teclado, mismos PNG de preview480, errores/reintento/guard/cierre/nombre seguro. Capturas móvil/escritorio inspeccionadas; Escape nativo devuelve foco al generador.389 fuentes/138 build con hashes intactos, procesos propios cerrados.

Renderer/brand diferido de26.269bytes intacto; selector añade1.034bytes raw en cierre estático Links/Detail respectoO86, Settings sin delta. No promesa de ahorro de latencia por añadir esta función. Límites de remuestreo188/240 de O86 conservados; resolución no equivale a garantizar lectura física de cualquier QR. Resumen runtime O87/verification-summary.json. No DB/proveedores/deploy ni cierre del objetivo global.
