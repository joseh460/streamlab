# PLAN MAESTRO — StreamLab (para ejecutar con Claude Code, en UNA sola conversación)

> Este archivo es la guía de trabajo. Léelo completo antes de empezar y vuelve a leerlo si pierdes contexto.
> La especificación técnica está en `SPEC.md` (única fuente de verdad del código).
> El manual original está en `docs/Manual_StreamLab_Streaming_AWS.pdf` (Anexo B = código de referencia).

## 0. Contexto del proyecto
- Es una práctica escolar: construir StreamLab (RTMP → HLS, chat Socket.io, SQLite, VOD) y desplegarla en AWS EC2.
- Equipo de dos personas. **Persona A (yo, quien te escribe)** deja la app lista, probada y documentada.
  **Persona B** (Windows + Git Bash, cuenta AWS propia con créditos) solo despliega en AWS y entrega el trabajo.
- Por eso todo lo que dejes debe poder usarse **sin conocer el código**: scripts simples, mensajes claros, cero ambigüedad.
- Queda fuera de alcance: Docker, Terraform, HTTPS/dominio, panel de estadísticas, moderación del chat. Solo lo que pide la rúbrica.

## 1. Reglas de trabajo (obligatorias)
1. **Una fase a la vez.** Al terminar una fase: marca sus casillas en la sección 2, haz el commit indicado,
   resume en máximo 3 líneas lo hecho y **DETENTE esperando que yo escriba "continúa"**.
2. **Un archivo por prompt.** Respuestas cortas y revisables. Sin explicaciones largas ni repetir el código en el chat.
3. **Errores: cambio mínimo.** Si algo falla, corrige solo el archivo afectado con el cambio mínimo. No reescribas todo.
   Si fallas dos veces con el mismo error, compara con el Anexo B del manual y dímelo.
4. **No inventes nada.** Ni resultados de pruebas, ni capturas, ni entradas del registro de prompts (ver sección 3).
   Si no pudiste probar algo, dilo y márcalo como "pendiente de probar por una persona".
5. **No hagas `git push`.** Yo subo a GitHub. Sí haz commits locales con mensajes claros en español.
6. **Nunca versionar secretos:** `.env`, `*.pem`, `data/`, `media/`, `node_modules/`, `docs/` van en `.gitignore`.
7. Estoy en Windows con **Git Bash**. Usa comandos compatibles con Git Bash. Si algo requiere otra cosa, avísame.
8. Si el contexto se llena o hago `/clear`: lee este archivo, mira la sección 2 y continúa en la primera casilla sin marcar.

## 2. Progreso (marca con [x] al terminar)
- [x] Fase 0 · Verificar entorno (faltan Node y ffmpeg; pendiente de instalar con autorización)
- [x] Fase 1 · Proyecto, dependencias y SPEC.md
- [ ] Fase 2 · Base de datos (db.js)
- [ ] Fase 3 · Servidor (server.js, partes 1 y 2)
- [ ] Fase 4 · Frontend (styles, common, index, channel, login, dashboard)
- [ ] Fase 5 · Pruebas locales (lista de 10 verificaciones)
- [ ] Fase 6 · Paquete de despliegue para AWS (deploy/ y DEPLOY.md)
- [ ] Fase 7 · Documentación final y entrega (README, PROMPTS_LOG, plantilla de reporte)

---

## Fase 0 · Verificar entorno
Comprueba (y dime qué falta, sin instalar nada sin avisarme):
`node -v` (debe ser ≥ 22.13), `npm -v`, `git --version`, `ffmpeg -version | head -1`, y en Windows la ruta de ffmpeg con
`cygpath -m "$(which ffmpeg)"`. Comprueba también que existen `SPEC.md` y `docs/Manual_StreamLab_Streaming_AWS.pdf`.
OBS Studio lo uso yo a mano; solo dime si debo instalarlo.
**Salida:** tabla corta OK / falta. Commit: no aplica. → DETENTE.

## Fase 1 · Proyecto, dependencias y SPEC.md  (Paso 1 y 2 del manual)
Ejecuta estos comandos en la carpeta del proyecto (si ya es un repo git, omite `git init`):
```
git init -b main
npm init -y
npm install express@4 socket.io bcryptjs dotenv hls.js
npm install node-media-server@2.7.0 --save-exact
npm pkg set scripts.start="node --disable-warning=ExperimentalWarning server.js"
npm pkg set engines.node=">=22.13"
printf 'node_modules/\ndata/\nmedia/\n.env\n*.pem\ndocs/\n' > .gitignore
mkdir -p public deploy
```
Crea además `.env.example` (comentado, en español) con: `PORT=3000`, `RTMP_PORT=1935`, `PUBLIC_HOST=`,
`FFMPEG_PATH=` (con nota: en Windows usar la salida de `cygpath -m "$(which ffmpeg)"`; en Linux/EC2 `/usr/bin/ffmpeg`),
`RECORD_VOD=true`. Verifica que `package-lock.json` exista (es obligatorio para `npm ci` en el servidor).
Crea mi `.env` local copiando `.env.example` y poniendo el `FFMPEG_PATH` real.
**Commit:** `Fase 1: proyecto base, dependencias y SPEC` → DETENTE.

## Fase 2 · Base de datos  (Prompt 1)
Prompt (úsalo tal cual y regístralo en PROMPTS_LOG.md):
> Lee @SPEC.md. Crea db.js: abre data/streamlab.db con DatabaseSync de node:sqlite (crea la carpeta data si no existe), activa WAL y foreign_keys, crea las tablas users, sessions y follows con CREATE TABLE IF NOT EXISTS y exporta db.
> Responde solo con el código.

Verifica: `node --disable-warning=ExperimentalWarning -e "require('./db'); console.log('BD lista')"` debe imprimir `BD lista`.
**Commit:** `Fase 2: base de datos SQLite` → DETENTE.

## Fase 3 · Servidor  (Prompts 2 y 3)
Prompt 2:
> Lee @SPEC.md y @db.js. Crea server.js (parte 1 de 2):
> - dotenv, constantes PORT, RTMP_PORT, FFMPEG, MEDIA, PUBLIC_HOST y CATEGORIES.
> - Middleware que lee la cookie sl_token y pone req.user; middleware auth (401).
> - Estáticos: public/, /vendor/hls.js -> node_modules/hls.js/dist, /media (no-cache .m3u8).
> - Todas las rutas /api de SPEC.md (register, login, logout, me, categories, channels, channels/:username con vods, follow toggle, following, dashboard GET/PUT, regenerate-key, health) y la ruta /c/:username.
> - listVods(username): .mp4 de media/live/<user> con size_mb, más recientes primero.
> - Crea http.createServer(app) y deja un comentario // PARTE 2 al final.
> Usa una función decorate(u) que agregue viewers, followers y thumb.
> Responde solo con el código.

Prompt 3:
> Lee @SPEC.md y @server.js. Completa server.js en // PARTE 2:
> 1) Socket.io: identifica al usuario por la cookie del handshake; eventos join, chat (anti-spam 700 ms, máx 300 caracteres, color por usuario), viewers al entrar y salir.
> 2) node-media-server 2.7.0: rtmp 1935, http 8000 en 127.0.0.1 con mediaroot MEDIA, trans con app 'live', hls y mp4 con los flags de SPEC.md.
> 3) prePublish: valida usuario + args.key; si falla nms.getSession(id).reject().
> 4) postPublish/donePublish: is_live, io.emit('live'), miniatura con ffmpeg cada 30 s.
> 5) Al iniciar: is_live = 0; nms.run(); server.listen(PORT).
> Devuelve solo el bloque nuevo de la parte 2.

Nota: el servidor puede no arrancar hasta terminar el Prompt 3 (decorate usa Socket.io). Es normal.
Verifica: `npm start` → imprime la web en el puerto del `.env` y RTMP en 1935; `curl -s localhost:3000/api/health` → `{"ok":true,...}`.
**Commit:** `Fase 3: servidor Express, Socket.io y RTMP→HLS` → DETENTE.

## Fase 4 · Frontend  (Prompts 4 a 8) — un prompt = un archivo
Prompt 4 (`public/styles.css`):
> Lee @SPEC.md (sección Estilo visual). Crea public/styles.css con: barra superior, logo, sidebar, chips de categorías, rejilla de tarjetas 16:9 con insignia EN VIVO / OFFLINE y espectadores, página de canal (reproductor + chat 340 px), formularios, panel del creador en 2 columnas, toast y media query < 900 px.
> Responde solo con el CSS.

Prompt 5 (`public/common.js`):
> Lee @SPEC.md. Crea public/common.js (sin módulos, funciones globales): api(url, opts) con fetch JSON y errores; esc() anti-XSS; colorFor(nombre); avatar(nombre); toast(msg); renderTopbar(active) que consulta /api/me y pinta logo, Explorar, Siguiendo, Mi canal y botones de sesión; renderSidebar(el) con /api/channels; cardHTML(canal) para las tarjetas. Responde solo con el código.

Prompt 6 (`public/index.html`):
> Usa @public/common.js y @public/styles.css. Crea public/index.html: sidebar + título + chips de /api/categories (Todo + 6 categorías con nº en vivo) + rejilla de canales. Soporta ?category= y ?tab=following (usa /api/following). Escucha el evento socket 'live' para recargar. Responde solo con el HTML.

Prompt 7 (`public/channel.html`):
> Usa @public/common.js. Crea public/channel.html para la ruta /c/:usuario:
> - Reproductor <video> con hls.js (liveSyncDurationCount 2, reintento si hay error fatal, Safari nativo) y pantalla "Canal desconectado".
> - Cabecera: avatar, nombre, título, categoría, EN VIVO + espectadores, seguidores, botón Seguir/Siguiendo (no a uno mismo). Sección Acerca de y lista de VOD (clic = reproducir el mp4).
> - Chat lateral con Socket.io: join, chat, chat:error, viewers, channel:update y live (si el canal inicia, recargar a los 2.5 s). Pide iniciar sesión para escribir.
> Responde solo con el HTML.

Prompt 8 (`public/login.html` y `public/dashboard.html`):
> Usa @public/common.js. Crea dos archivos:
> 1) public/login.html: pestañas Iniciar sesión / Registrarse (#register abre la 2ª), usuario, contraseña, mensaje de error. Tras registrarse ir a /dashboard.html.
> 2) public/dashboard.html: si no hay sesión redirige a /login.html. Tarjeta "Información del stream" (estado, título, categoría, descripción, Guardar, Ver mi canal) y tarjeta "Conexión con OBS" (Servidor rtmp_url y clave obs_key con botones copiar / mostrar, Regenerar clave con confirmación, recomendaciones de OBS).
> Responde solo con el código de ambos archivos.

Haz un commit por cada prompt (`Fase 4: styles.css`, `Fase 4: common.js`, …). Al terminar todos → DETENTE.

## Fase 5 · Pruebas locales  (Paso 10 del manual)
Arranca el servidor y ejecuta lo que se pueda automatizar con `curl` y `ffmpeg` (canal de prueba con
`ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -c:v libx264 -preset veryfast -b:v 2500k -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k -f flv "rtmp://localhost:1935/live/USUARIO?key=CLAVE"`).
Devuélveme una tabla con las 10 pruebas y el resultado REAL de cada una:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Registrar usuario con nombre inválido ("x") | Mensaje "Usuario: 3-20 caracteres…" |
| 2 | Transmitir con clave incorrecta | Conexión rechazada |
| 3 | Transmitir con clave correcta | EN VIVO en Explorar en ≈3 s, con miniatura |
| 4 | Reproducir el canal | El video avanza; latencia de 6 a 10 s |
| 5 | Abrir el canal en dos navegadores | Contador de espectadores = 2 |
| 6 | Chatear entre dos usuarios | Ambos ven los mensajes al instante |
| 7 | Chatear sin sesión | "Inicia sesión para chatear" |
| 8 | Seguirse a sí mismo / seguir a otro | Error / contador +1 y aparece en Siguiendo |
| 9 | Detener OBS y recargar el canal | Pantalla "desconectado" y VOD nuevo en la lista |
| 10 | Regenerar clave | La clave anterior deja de funcionar |

Marca cada fila como **✔ verificada por ti** (curl/ffmpeg/API) o **👤 la debo probar yo a mano** (navegador, OBS, dos pestañas).
Las pruebas 4, 5, 6 y 9 normalmente necesitan navegador: indícame exactamente qué hacer. Corrige fallos con cambio mínimo.
**Commit:** `Fase 5: correcciones tras pruebas locales` (solo si hubo cambios) → DETENTE.

## Fase 6 · Paquete de despliegue para AWS  (lo que usará la Persona B)
Objetivo: que la Persona B (Windows + Git Bash, cuenta AWS con créditos, usuario IAM `streamlab-cli`) despliegue **sin tocar código**
y obtenga **las capturas que pide la rúbrica**. Todo en `deploy/`, con `#!/usr/bin/env bash`, `set -euo pipefail`,
mensajes en español, y cada script debe: (a) exportar `MSYS_NO_PATHCONV=1`, (b) definir `awst() { aws "$@" --output text | tr -d '\r'; }`,
(c) comprobar requisitos (`aws sts get-caller-identity`, región `us-east-1`) y fallar con un mensaje claro si algo falta,
(d) imprimir líneas `📸 CAPTURA n: <qué capturar>` en los momentos que sirven de evidencia para el reporte.

1. **`deploy/setup-ec2.sh`** — script que corre DENTRO de la EC2 (Ubuntu 24.04): instala ffmpeg, git, curl, Node 22, swap de 1 GB,
   `npm ci --omit=dev`, crea `.env` de producción (`PORT=80`, `RTMP_PORT=1935`, `PUBLIC_HOST=`, `FFMPEG_PATH=/usr/bin/ffmpeg`, `RECORD_VOD=true`),
   `setcap` para el puerto 80 y PM2 con arranque automático; al final comprueba `http://localhost/api/health` e imprime la URL web y la de OBS.
   Tómalo del Anexo B del manual (PDF, `deploy/setup-ec2.sh`). Cuidado: al extraer del PDF las líneas largas pueden venir partidas;
   revisa cada línea y valida con `bash -n deploy/setup-ec2.sh` (y `shellcheck` si está instalado).
2. **`deploy/aws-create.sh`** (Pasos 14–15 del manual) — crea el key pair `streamlab-key` (ed25519, guardada en `~/.ssh/streamlab-key.pem`, `chmod 400`),
   el grupo de seguridad `streamlab-sg` en la VPC por defecto (SSH 22 **solo desde la IP pública actual**, 80 y 1935 abiertos),
   lanza `t3.micro` Ubuntu 24.04 (`resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id`, disco gp3 de 10 GB, tag `Name=streamlab`),
   espera `instance-status-ok`, obtiene la IP pública y guarda `SG_ID`, `INSTANCE_ID`, `IP` en `~/streamlab-aws.env`.
   Si ya existe `~/streamlab-aws.env` o la llave, **no sobrescribe**: avisa y termina.
3. **`deploy/aws-install.sh <URL_DEL_REPO>`** (Paso 16) — por SSH ejecuta `git clone` (o `git pull` si ya existe) y `bash deploy/setup-ec2.sh`; imprime la URL final.
4. **`deploy/smoke-test.sh <IP> [usuario clave]`** — comprueba `http://IP/api/health`, que `/` responda 200 y, si se dan usuario y clave, transmite 15 s con ffmpeg
   y confirma que `/media/live/<usuario>/index.m3u8` responde 200. Sale con código ≠ 0 si algo falla.
5. **`deploy/aws-destroy.sh`** (Paso 19B) — pide confirmación escribiendo `ELIMINAR`; termina la instancia, espera `instance-terminated`,
   borra el grupo de seguridad y el key pair, borra `~/.ssh/streamlab-key.pem` y `~/streamlab-aws.env`, y muestra la captura final (`📸` instancia en estado `terminated`).
6. **`DEPLOY.md`** (en la raíz) — guía numerada y corta para la Persona B, en español y para Windows/Git Bash:
   requisitos (Git Bash, AWS CLI v2, cuenta AWS) · Paso 12 manual en consola (crear usuario IAM `streamlab-cli` con `AmazonEC2FullAccess` y `AmazonSSMReadOnlyAccess`,
   clave de acceso, **alerta de presupuesto "Zero spend"**, `aws configure`, `aws sts get-caller-identity`) · orden de ejecución de los scripts ·
   cómo conectarse por SSH · cómo actualizar (`git pull && npm ci --omit=dev && pm2 restart streamlab`) · pausar/reanudar la instancia (la IP cambia) ·
   tabla **"Capturas para el reporte"** (qué capturar y en qué paso) · tabla de **errores comunes** (Invalid id con `\r`, rutas convertidas a `C:/Program Files/Git/…`,
   `UNPROTECTED PRIVATE KEY FILE` → `icacls "$(cygpath -w ~/.ssh/streamlab-key.pem)" /inheritance:r /grant:r "$USERNAME:R"`, IP cambiada → nueva regla del puerto 22,
   disco lleno) · recordatorio de costos (≈ 0.0104 USD/h la t3.micro + IPv4 pública 0.005 USD/h; **eliminar todo al terminar**).
   Sin Docker, sin HTTPS, sin retos opcionales.

Valida cada script con `bash -n` y revisa que no haya `\r` (formato LF). **No puedes ejecutar los scripts de AWS** (sin cuenta); dilo explícitamente en `DEPLOY.md`
como "no probados contra AWS real por quien los escribió" y deja mensajes de error claros.
**Commit:** `Fase 6: scripts y guía de despliegue AWS` → DETENTE.

## Fase 7 · Documentación final y entrega
1. **`README.md`**: qué es StreamLab, requisitos, cómo correrlo en local (`.env`, `npm start`, OBS), estructura, enlace a `DEPLOY.md`.
2. **`PROMPTS_LOG.md`**: registro REAL de uso de IA (ver sección 3). Rellénalo solo con lo que ocurrió en esta conversación.
3. **`REPORTE_PLANTILLA.md`**: esqueleto del reporte (PDF, máx. 5 páginas) con apartados: portada, resumen · capturas de la lista de verificación en AWS ·
   prompts usados y cuántos se necesitaron (se alimenta de `PROMPTS_LOG.md`) · costo final según la consola de facturación · evidencia de recursos eliminados
   (instancia `terminated`) · respuestas a las 5 preguntas de reflexión (latencia con 5 mediciones: media y desviación estándar, con `hls_time` 1/2/4; por qué no se recodifica;
   estimación de costo de transferencia para 50, 500 y 5,000 espectadores durante 2 h con la fórmula bitrate × espectadores × tiempo; aporte del streaming a una plataforma
   multicontenido; riesgo de poner la clave en la URL pública). **Deja los datos como campos vacíos `[COMPLETAR]`: no inventes mediciones, costos ni capturas.**
4. Revisión final: `git status` limpio, `.gitignore` correcto (sin `.env`, `*.pem`, `data/`, `media/`, `docs/`), `package-lock.json` versionado, `git log --oneline` legible.
5. Entrégame un **checklist de traspaso** a la Persona B: qué repo clonar, qué archivo leer primero (`DEPLOY.md`), qué necesita tener listo y qué capturas guardar.
**Commit:** `Fase 7: documentación y plantilla de reporte` → DETENTE. Yo haré el `git push`.

---

## 3. Registro de prompts (`PROMPTS_LOG.md`) — honestidad obligatoria
El reporte debe mostrar los prompts realmente usados y cuántos hicieron falta. Por eso:
- Cada entrada = prompt (texto exacto), herramienta/modelo usado, número de intentos, qué falló y qué se corrigió.
- Formato por fila: `| Fase | Archivo | Prompt (resumen o texto) | Modelo | Intentos | Correcciones |`.
- Los prompts de este plan se ejecutan desde `PLAN.md`; anótalo así ("prompt tomado de PLAN.md, Fase N").
- Si hubo ajustes manuales míos, regístralos también. **Prohibido inventar o redondear intentos.** Si no estás seguro, escribe "no registrado".

## 4. Criterios de "listo para pasar a la Persona B"
- [ ] `npm start` funciona desde una carpeta limpia (`npm ci` + `.env` copiado de `.env.example`).
- [ ] Las 10 pruebas de la Fase 5 tienen resultado real (✔ o 👤 con instrucciones).
- [ ] `deploy/` completo con `bash -n` sin errores y `DEPLOY.md` claro para Windows/Git Bash.
- [ ] `README.md`, `PROMPTS_LOG.md` y `REPORTE_PLANTILLA.md` presentes.
- [ ] Repo sin secretos y con historial de commits claro.
