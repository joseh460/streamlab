# Registro de prompts (uso de IA)

Registro real, rellenado fase por fase. Si un dato no se conoce: "no registrado".

| Fase | Archivo | Prompt (resumen o texto) | Modelo | Intentos | Correcciones |
|---|---|---|---|---|---|
| 2 | db.js | Prompt 1 tomado de PLAN.md, Fase 2 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna en db.js. Un comando de verificación mío falló por comillas en PowerShell; se repitió con el comando exacto del plan y dio `BD lista`. |
| 3 | server.js (parte 1) | Prompt 2 tomado de PLAN.md, Fase 3 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna tras probar arranque, /api/health, /api/categories y validación de registro. |
| 3 | server.js (parte 2) | Prompt 3 tomado de PLAN.md, Fase 3 (texto exacto allí) | Claude Sonnet 5.5 (Claude Code) | 1 | Ninguna en el arranque. Chat, RTMP y miniaturas se prueban en la Fase 5. |
