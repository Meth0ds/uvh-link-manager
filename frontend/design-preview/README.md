# Vista de diseño aislada

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
