#!/usr/bin/env bash
# Prueba de carga LOCAL y aislada (Git Bash, Windows/Linux).
# Levanta su propio servidor en puertos 3100/1936/8100 con datos temporales (NO toca tu servidor
# normal ni tu base de datos), transmite un canal de prueba, lanza los bots y muestra métricas.
# Uso:  bash loadtest/run-local.sh [BOTS] [SEGUNDOS] [HLS 0|1] [RAMP bots/s] [CHAT ms]
#   p. ej.  bash loadtest/run-local.sh 200 40 1 50 5000
set -uo pipefail
cd "$(dirname "$0")/.."
BOTS="${1:-200}"; DUR="${2:-40}"; HLS="${3:-1}"; RAMP="${4:-50}"; CHAT="${5:-5000}"
PORT=3100; RTMP=1936; NMSP=8100
TMP="$(mktemp -d)"
FFMPEG_BIN="${FFMPEG_PATH:-$(grep -s '^FFMPEG_PATH=' .env | cut -d= -f2-)}"; FFMPEG_BIN="${FFMPEG_BIN:-ffmpeg}"

for p in $PORT $RTMP $NMSP; do
  if (echo > /dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "❌ El puerto $p ya está en uso; cierra lo que lo use."; exit 1; fi
done

PORT=$PORT RTMP_PORT=$RTMP NMS_HTTP_PORT=$NMSP DATA_DIR="$TMP/data" MEDIA_DIR="$TMP/media" \
  node --disable-warning=ExperimentalWarning server.js > "$TMP/server.log" 2>&1 &
SRV=$!; FF=""
cleanup() { [ "${SAMPLE:-0}" = 1 ] && [ -f "$TMP/hls-samples.log" ] && { echo "--- muestras HLS (lista vs disco), primeras 40:"; head -40 "$TMP/hls-samples.log"; }; kill "${SAMPLER:-0}" 2>/dev/null; kill "$FF" 2>/dev/null; kill "$SRV" 2>/dev/null; sleep 1; rm -rf "$TMP" 2>/dev/null; }
trap cleanup EXIT
sleep 4
# SERVER_CORES=N (solo Windows): limita servidor+hilos+ffmpeg a N núcleos y deja bots y emisor en los demás,
# para parecerse a una EC2 de N vCPU (p. ej. SERVER_CORES=2 bash loadtest/run-local.sh 200 40 1 50 5000)
if [ "${SERVER_CORES:-0}" -gt 0 ] && command -v powershell >/dev/null; then
  powershell -NoProfile -Command "
    \$n=[Environment]::ProcessorCount; \$srv=[int64]([math]::Pow(2,${SERVER_CORES})-1); \$all=[int64]([math]::Pow(2,\$n)-1); \$rest=\$all -band (-bnot \$srv);
    (Get-Process -Id $(cat /proc/$SRV/winpid)).ProcessorAffinity=\$srv;
    (Get-Process -Id $(cat /proc/$$/winpid)).ProcessorAffinity=\$rest;
    'servidor limitado a ${SERVER_CORES} núcleo(s) de '+\$n" || echo "(aviso) no se pudo limitar los núcleos"
fi
B="http://localhost:$PORT"
curl -s -f "$B/api/health" >/dev/null || { echo "❌ El servidor de prueba no arrancó:"; tail -5 "$TMP/server.log"; exit 1; }

curl -s -c "$TMP/cj" -X POST -H 'content-type: application/json' -d '{"username":"alice","password":"123456"}' "$B/api/register" >/dev/null
KEY=$(curl -s -b "$TMP/cj" "$B/api/dashboard" | node -pe 'JSON.parse(require("fs").readFileSync(0)).stream_key')
if [ "$HLS" = 1 ]; then
  VB="${VIDEO_KBPS:-2500}"
  "$FFMPEG_BIN" -hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i sine=frequency=440 \
    -c:v libx264 -preset veryfast -b:v ${VB}k -maxrate ${VB}k -bufsize $((VB*2))k -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k \
    -t $((DUR + BOTS / RAMP + 40)) -f flv "rtmp://localhost:$RTMP/live/alice?key=$KEY" > "$TMP/ffmpeg.log" 2>&1 &
  FF=$!
  sleep 8
fi
if [ "${SAMPLE:-0}" = 1 ]; then ( S0=$SECONDS; while true; do echo "t+$((SECONDS-S0))s lista: $(curl -s -m 2 "$B/media/live/alice/index.m3u8" | grep -o "index[0-9]*.ts" | sed "s/index//; s/.ts//" | tr "
" " ") | disco: $(ls "$TMP/media/live/alice" 2>/dev/null | grep ".ts" | sed "s/index//; s/.ts//" | sort -n | tr "
" " ")" >> "$TMP/hls-samples.log"; sleep 1; done ) & SAMPLER=$!; fi
echo "--- antes: $(curl -s "$B/api/health?reset=1")"
node loadtest/bots.js --url "$B" --channel alice --bots "$BOTS" --duration "$DUR" --ramp "$RAMP" --chat "$CHAT" --hls "$HLS" --debug "${DEBUG:-0}"
RC=$?
echo "--- después: $(curl -s "$B/api/health")"
exit $RC
