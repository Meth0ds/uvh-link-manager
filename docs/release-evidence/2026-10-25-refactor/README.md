# Evidencia de la refactorización

Fecha: **25 de octubre de 2026**. Base: `d5d0b7d01aa6f740fbe0312012b1edf1178c4960`.

Se conservan **55 capturas** del Angular compilado real y de la página independiente. Los fixtures son ficticios, de solo lectura y exclusivos de `design-preview`. No reconstruyen manualmente la interfaz ni conceden acceso a la aplicación de producción.

La comparación cubre escritorio de 1.440 px y móvil de 390 px, claro/oscuro y movimiento reducido. Incluye copias locales sin destino externo, destino preparado, operación activa, error externo, intervención, autorización, mantenimiento, recuperación y los diálogos de restauración.

De las 20 comparaciones antes/después, 19 son idénticas. La restante contiene cinco píxeles con una diferencia máxima de 1/255 por canal. También se comprueba que una actualización de estado conserve el foco, el borrador activo y las dos rutas seleccionadas en la restauración guiada.

## Archivos

- [Capturas y hashes](screenshots.sha256).
- [Comparación, errores de navegador y resultados axe](visual-results.json).
- [Benchmark emparejado y muestras](measurements/benchmarks-paired.json).
- [Memoria de transferencias](measurements/transfer-memory.json).
- [Tamaño del frontend](measurements/bundle-metrics.json).
- [Recursos empaquetados](measurements/packaging-metrics.json).
- [Resultados PHP por lote](measurements/backend-results.json).
- [Equivalencia de los 31 métodos PHP extraídos](measurements/php-extraction-equivalence.json).
- [Hashes de ejecutables](measurements/executables.json).
- [Hashes de los fuentes modificados](measurements/source-files.json).
- [Informe de implementación y límites](../../refactor-optimization-2026-10-25.md).

`visual-results.json` conserva incidencias ARIA y de contraste presentes tanto en la base como en la implementación. No se han excluido del informe. Los dos fallos previos de contratos PHP y la ausencia de ejecución nativa en Windows están detallados en el informe principal.

Para verificar las capturas, desde este directorio:

```sh
shasum -a 256 -c screenshots.sha256
```

La evidencia histórica de 2026-10-23 permanece en su directorio original; su representación administrativa manual deja de ser la referencia de regresión de esta entrega.
