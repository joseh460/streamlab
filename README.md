# StreamLab

Clon ligero de Twitch para una práctica escolar. Un streamer transmite desde **OBS por RTMP**, el servidor lo convierte a **HLS** (sin recodificar) y los espectadores lo ven en el navegador con chat en tiempo real. Incluye registro/login, seguir canales, categorías, panel del creador y grabaciones (VOD).

## Qué incluye
- RTMP → HLS con `node-media-server` 2.7.0 y ffmpeg (transmux, sin recodificar), más grabación en `.mp4`.
- Chat con Socket.io (anti-spam, máx. 300 caracteres) y contador de espectadores.
- Base de datos SQLite (`node:sqlite`, sin módulos nativos).
- Clave de transmisión secreta: se valida al publicar, y la URL pública del video no la expone.
- Interfaz en español, tema oscuro y responsive.

Fuera de alcance: Docker, Terraform, HTTPS/dominio, estadísticas y moderación del chat.

## Requisitos
- **Node.js ≥ 22.13** (se usa `node:sqlite`).
- **ffmpeg** instalado.
- **OBS Studio** (solo para transmitir a mano).

## Correr en local
```bash
npm ci
cp .env.example .env
```
Edita `.env` y pon `FFMPEG_PATH`. En Windows (Git Bash) usa la salida de:
```bash
cygpath -m "$(which ffmpeg)"
```
Luego:
```bash
npm start
```
- Web: <http://localhost:3000>
- RTMP: `rtmp://localhost:1935/live`

### Transmitir
1. Regístrate en `http://localhost:3000/login.html#register` y entra a **Mi canal**.
2. Copia el **Servidor** y la **Clave** en OBS: Ajustes → Emisión → Servicio «Personalizado…». Recomendado: x264, 2500 kbps, fotogramas clave cada 2 s, AAC 128 kbps, 1280×720 a 30 fps.
3. Pulsa «Iniciar transmisión». El canal aparece EN VIVO en Explorar y en `http://localhost:3000/c/TU_USUARIO`.

Sin OBS, con ffmpeg (sustituye `USUARIO` y `CLAVE`):
```bash
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 \
  -c:v libx264 -preset veryfast -b:v 2500k -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k \
  -f flv "rtmp://localhost:1935/live/USUARIO?key=CLAVE"
```

## Variables de entorno (`.env`)
| Variable | Descripción |
|---|---|
| `PORT` | Puerto de la web (80 en producción) |
| `RTMP_PORT` | Puerto RTMP (1935) |
| `PUBLIC_HOST` | IP/dominio mostrado en el panel para OBS (vacío = el host con el que se abre la web) |
| `FFMPEG_PATH` | Ruta de ffmpeg (`/usr/bin/ffmpeg` en Linux) |
| `RECORD_VOD` | `true`/`false`: grabar cada transmisión en `.mp4` |

## Estructura
```
server.js        Express + API + Socket.io + node-media-server
db.js            Conexión SQLite y tablas
public/          styles.css, common.js, index.html, channel.html, login.html, dashboard.html
deploy/          setup-ec2.sh y scripts de AWS (create, install, smoke-test, destroy)
SPEC.md          Especificación técnica
PLAN.md          Plan de trabajo por fases
DEPLOY.md        Guía de despliegue en AWS
PROMPTS_LOG.md   Registro del uso de IA
REPORTE_PLANTILLA.md  Esqueleto del reporte
data/, media/    (generados, no se versionan) base de datos y video
```

## Despliegue en AWS
Ver **[DEPLOY.md](DEPLOY.md)**.

## Notas
- `node-media-server@2.7.0` abre además un HTTP interno en el puerto 8000 (no se usa desde fuera).
- Probado en el navegador integrado de Claude (Chromium): Explorar, canal con video HLS, chat, contador de espectadores, seguir, panel, VOD y pantalla "desconectado". No se probó con OBS real, en Safari ni en móvil.
