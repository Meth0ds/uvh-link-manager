# Evidencia visual del centro local

Fecha de la captura: 24 de octubre de 2026 (Europe/Madrid).

Las capturas cubren la página de mantenimiento, el acceso de recuperación y el panel autenticado en escritorio y móvil. Se generaron con `node scripts/recovery/screenshot-evidence.mjs`, que sirve la misma página independiente del controlador con datos ficticios y no usa cuentas, secretos ni la base de datos local.

| Archivo | Escenario |
| --- | --- |
| `screenshots/01-maintenance-desktop.png` | Mantenimiento en escritorio |
| `screenshots/06-admin-dashboard-section-desktop.png` | Sección administrativa integrada en el dashboard |
| `screenshots/02-recovery-login-desktop.png` | Acceso de emergencia |
| `screenshots/03-recovery-dashboard-desktop.png` | Diagnóstico, copias, comprobaciones y actualización |
| `screenshots/04-maintenance-mobile.png` | Mantenimiento en móvil |
| `screenshots/05-recovery-dashboard-mobile.png` | Centro autenticado en móvil |
| `screenshots/07-recovery-intervention-desktop.png` | Fallo posterior a la actualización que exige intervención |

Los hashes están en [`SHA256SUMS`](SHA256SUMS). Las capturas son evidencia visual de la composición y de los estados de interfaz; la evidencia funcional está en `scripts/recovery/recovery.test.mjs` y `scripts/recovery/backup-drill.mjs`.
