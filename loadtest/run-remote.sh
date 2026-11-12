#!/usr/bin/env bash
# Prueba de carga contra un servidor YA DESPLEGADO (la EC2, un contenedor, otra máquina).
# Crea un usuario "streamer", transmite un canal de prueba con ffmpeg, lanza los bots y muestra métricas.
# Uso:  bash loadtest/run-remote.sh <URL_WEB> <HOST_RTMP> [BOTS] [SEGUNDOS] [HLS 0|1] [RAMP bots/s] [CHAT ms]
#   p. ej.  bash loadtest/run-remote.sh http://54.1.2.3 54.1.2.3 200 60 1 20 10000
# Variables opcionales: VIDEO_KBPS (por defecto 1500), FFMPEG_PATH, DEBUG=1
# Requiere: node, curl y (si HLS=1) ffmpeg en la máquina desde la que lanzas los bots.
# ⚠ HLS=1 descarga cientos de Mbps: lánzalo desde una máquina con buena red, no desde casa.
set -uo pipefail
cd "$(dirname "$0")/.."
URL="${1:-}"; RTMP_HOST="${2:-}"; BOTS="${3:-200}"; DUR="${4:-60}"; HLS="${5:-1}"; RAMP="${6:-20}"; CHAT="${7:-10000}"
[ -n "$URL" ] && [ -n "$RTMP_HOST" ] || { echo "Uso: bash loadtest/run-remote.sh <URL_WEB> <HOST_RTMP> [BOTS] [SEGUNDOS] [HLS] [RAMP] [CHAT_MS]"; exit 2; }
URL="${URL%/}"
FFMPEG_BIN="${FFMPEG_PATH:-ffmpeg}"
VB="${VIDEO_KBPS:-1500}"
TMP="$(mktemp -d)"; FF=""
cleanup() { [ -n "$FF" ] && kill "$FF" 2>/dev/null; rm -rf "$TMP" 2>/dev/null; }
trap cleanup EXIT

curl -fs --max-time 10 "$URL/api/health" >/dev/null || { echo "❌ $URL/api/health no responde"; exit 1; }
STREAMER="tx$(date +%s | tail -c 7)"
curl -fs -c "$TMP/cj" -X POST -H 'content-type: application/json' -d "{\"username\":\"$STREAMER\",\"password\":\"123456\"}" "$URL/api/register" >/dev/null \
  || { echo "❌ No se pudo crear el usuario emisor"; exit 1; }
KEY=$(curl -fs -b "$TMP/cj" "$URL/api/dashboard" | node -pe 'JSON.parse(require("fs").readFileSync(0)).obs_key')

if [ "$HLS" = 1 ]; then
  command -v "$FFMPEG_BIN" >/dev/null || { echo "❌ No hay ffmpeg para transmitir el canal de prueba"; exit 1; }
  "$FFMPEG_BIN" -hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i sine=frequency=440 \
    -c:v libx264 -preset veryfast -b:v ${VB}k -maxrate ${VB}k -bufsize $((VB*2))k -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k \
    -t $((DUR + BOTS / RAMP + 40)) -f flv "rtmp://$RTMP_HOST:1935/live/$STREAMER?key=$KEY" > "$TMP/ffmpeg.log" 2>&1 &
  FF=$!
  sleep 8
  grep -q . "$TMP/ffmpeg.log" && { echo "❌ ffmpeg falló:"; cat "$TMP/ffmpeg.log"; exit 1; }
fi
echo "--- antes:   $(curl -s "$URL/api/health?reset=1")"
node loadtest/bots.js --url "$URL" --channel "$STREAMER" --bots "$BOTS" --duration "$DUR" --ramp "$RAMP" --chat "$CHAT" --hls "$HLS" --debug "${DEBUG:-0}"
RC=$?
echo "--- después: $(curl -s "$URL/api/health")"
exit $RC
