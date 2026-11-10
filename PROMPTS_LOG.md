# Registro de prompts (uso de IA)

Registro real, rellenado fase por fase. Si un dato no se conoce: "no registrado".

| Fase | Archivo | Prompt (resumen o texto) | Modelo | Intentos | Correcciones |
|---|---|---|---|---|---|
| 2 | db.js | Prompt 1 tomado de PLAN.md, Fase 2 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna en db.js. Un comando de verificación mío falló por comillas en PowerShell; se repitió con el comando exacto del plan y dio `BD lista`. |
| 3 | server.js (parte 1) | Prompt 2 tomado de PLAN.md, Fase 3 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna tras probar arranque, /api/health, /api/categories y validación de registro. |
| 3 | server.js (parte 2) | Prompt 3 tomado de PLAN.md, Fase 3 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna en el arranque. En la Fase 5 las pruebas mostraron que en Windows no se generaba el HLS (la ruta `MEDIA` con `\` rompe el muxer `tee` de ffmpeg); corregido a mano con 1 cambio mínimo en server.js (mediaroot con `/`). |
| 4 | public/styles.css | Prompt 4 tomado de PLAN.md, Fase 4 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna. Aspecto visual sin revisar en navegador (pendiente de revisar por una persona). |
| 4 | public/common.js | Prompt 5 tomado de PLAN.md, Fase 4 | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna. Revisión de sintaxis con node --check. |
| 4 | public/index.html | Prompt 6 tomado de PLAN.md, Fase 4 | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna. Se sirve con 200; comportamiento en navegador pendiente de probar (Fase 5). |
| 4 | public/channel.html | Prompt 7 tomado de PLAN.md, Fase 4 | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna. Se sirve con 200; reproductor y chat pendientes de probar en navegador (Fase 5). |
| 4 | public/login.html y public/dashboard.html | Prompt 8 tomado de PLAN.md, Fase 4 | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna. Registro y GET /api/dashboard verificados por curl; interfaz pendiente de probar en navegador. |
| 6 | deploy/*.sh y DEPLOY.md | Instrucciones de la Fase 6 de PLAN.md (no son prompts numerados); setup-ec2.sh tomado del Anexo B del manual | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna en el contenido. Validado con bash -n y bytes CR=0; smoke-test.sh probado contra la app local (4 casos). Scripts de AWS NO probados contra AWS real. Se añadió .gitattributes (*.sh eol=lf). |
