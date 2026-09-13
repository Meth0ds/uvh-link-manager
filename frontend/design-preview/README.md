# Vista de diseño aislada

También disponibles:

- `/status`: componente público real con escenarios ficticios operativo,
  interrupción, desconocido, error y carga. No representa un monitor real.
- `/app/webhooks/9001`: inspector real con cuatro estados de entrega, errores
  e identificadores largos. Cambia al workspace Archivo editorial para revisar
  solo lectura. Las acciones de escritura están bloqueadas; no hay receptor real.

Desde `frontend`:

```powershell
node node_modules/@angular/cli/bin/ng.js serve --configuration design-preview --host 127.0.0.1 --port 4301 --no-open
```

Abrir `http://127.0.0.1:4301/app/dashboard` para revisar **los componentes reales**
de navegación, cabecera y diálogos. Los datos son ficticios y están etiquetados.
El selector permite observar owner/viewer; las operaciones de API se rechazan
y no existe proxy hacia el backend. No hay login ni credenciales de prueba.

Este punto de entrada no pertenece a `src/main.ts`, al router de producción ni
a su build predeterminado. Produce `dist/design-preview`, separado de `dist/uvh`.
No desplegarlo. No utilizar su estado simulado como prueba funcional de una
cuenta, autorización del servidor, persistencia o integraciones.

Comprobar tipos con `node node_modules/typescript/bin/tsc --noEmit -p design-preview/tsconfig.json`.
El código y las plantillas inline están incluidos en ESLint.

La ruta `/app/tokens` representa el componente real de Tokens con metadatos
ficticios: nombre largo sin espacios, token revocado y estados vacío/error/carga.
No contiene secretos ni concede credenciales; todas las escrituras se rechazan.
No pulsar acciones de emisión/revocación como validación de seguridad real.
