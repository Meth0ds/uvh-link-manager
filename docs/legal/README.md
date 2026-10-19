# Documentos legales de UVH

Versión incorporada a las rutas públicas y a registro/activación: **2026-10-09**. Autorización del titular: publicar los borradores como documentos definitivos del producto. Las copias terms.html y privacy.html contienen las mismas cláusulas que las páginas públicas.

Copias públicas: frontend/public/legal/versions/2026-10-09/. Se conserva la versión anterior de 2026-08-30. Los borradores originales quedan en el historial de preparación de QA; no se sirven como documentos vigentes.

La versión **no cambia al añadir un idioma**: las copias francesas se preparan bajo la misma versión 2026-10-09, en `frontend/public/legal/versions/2026-10-09/fr/`, con su propio manifiesto y hash. Añadir una traducción no altera los hashes español e inglés ni exige una nueva aceptación a quien ya aceptó esos textos. Las copias francesas están registradas en `shared/localisation/legal-documents.json` desde el 2026-10-19, con su `path` y `sha256`; ese registro es el que usa el backend para la evidencia de aceptación.

Estado del francés: `terms.html`, `privacy.html` y `manifest.json` están redactados en `fr/` y publicados bajo la versión 2026-10-09. Se generan con `node scripts/build.mjs --configuration fr --output-path=dist/uvh-fr` y `frontend/scripts/publish-french-legal-copy.mjs 2026-10-09`. El idioma está publicado (`RELEASED_LANGUAGES` incluye `fr`, `UVH_FRENCH_ENABLED=true` en el entorno local), pero **la revisión jurídica del texto francés sigue pendiente**: la publicación no equivale a aprobación jurídica.

La matriz publication-readiness.html mantiene las obligaciones y datos que requieren evidencia externa. Sigue pendiente confirmar domicilio completo/código postal, proveedor real de correo y garantías operativas. Esta integración no certifica cumplimiento integral ni despliegue en producción. No se alteran aceptaciones anteriores.
