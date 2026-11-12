#!/usr/bin/env bash
# =============================================================
# StreamLab · Prueba rápida del servidor desplegado
# Uso:  bash deploy/smoke-test.sh <IP> [usuario clave]
#   Sin usuario/clave: comprueba /api/health y la página principal.
#   Con usuario y clave: además transmite 15 s con ffmpeg y comprueba el HLS.
# Sale con código distinto de 0 si algo falla.
# =============================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1

IP="${1:-}"
USR="${2:-}"
KEY="${3:-}"
[ -n "$IP" ] || { echo "❌ Uso: bash deploy/smoke-test.sh <IP> [usuario clave]" >&2; exit 2; }
KEY="${KEY##*key=}"   # acepta la clave completa del panel (usuario?key=sk_…) o solo sk_…
[ -z "$USR" ] || [ -n "$KEY" ] || { echo "❌ Si das un usuario, da también la clave." >&2; exit 2; }
command -v curl >/dev/null || { echo "❌ No se encontró curl." >&2; exit 2; }

FAILS=0
ok()  { echo "✔ $*"; }
bad() { echo "✘ $*"; FAILS=$((FAILS + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || true; }

H=$(curl -fs --max-time 10 "http://$IP/api/health" || true)
if [[ "$H" == *'"ok":true'* ]]; then ok "/api/health responde: $H"; else bad "/api/health no responde bien (respuesta: '${H:-nada}')"; fi

C=$(code "http://$IP/")
if [ "$C" = 200 ]; then ok "La página principal responde 200"; else bad "La página principal respondió '$C' (se esperaba 200)"; fi

if [ -n "$USR" ]; then
  FFMPEG_BIN="${FFMPEG_PATH:-ffmpeg}"
  if ! command -v "$FFMPEG_BIN" >/dev/null; then
    bad "No hay ffmpeg en tu PC para transmitir la prueba (instálalo o usa OBS y prueba a mano)"
  else
    echo "… Transmitiendo 15 s a rtmp://$IP:1935/live/$USR"
    "$FFMPEG_BIN" -hide_banner -loglevel error -re \
      -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 \
      -c:v libx264 -preset veryfast -b:v 2500k -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k \
      -t 15 -f flv "rtmp://$IP:1935/live/$USR?key=$KEY" 2>/tmp/streamlab-smoke-ffmpeg.log &
    FF=$!
    M=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      M=$(code "http://$IP/media/live/$USR/index.m3u8")
      [ "$M" = 200 ] && break
    done
    if [ "$M" = 200 ]; then ok "El HLS /media/live/$USR/index.m3u8 responde 200"; else bad "El HLS respondió '$M' (se esperaba 200)"; fi
    wait "$FF" || bad "ffmpeg no pudo transmitir (¿usuario o clave incorrectos?): $(tail -2 /tmp/streamlab-smoke-ffmpeg.log 2>/dev/null)"
    echo "📸 CAPTURA 4: http://$IP/c/$USR con el video en directo (hazla mientras transmites desde OBS)"
  fi
fi

echo ""
if [ "$FAILS" -eq 0 ]; then echo "Todo correcto ✔"; exit 0; else echo "$FAILS comprobación(es) fallaron ✘"; exit 1; fi
