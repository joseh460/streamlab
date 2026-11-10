#!/usr/bin/env bash
# =============================================================
# StreamLab · Instala la app en la EC2 por SSH (Paso 16 del manual)
# Uso (en tu PC, Git Bash):  bash deploy/aws-install.sh https://github.com/USUARIO/streamlab.git
# El repositorio debe poder clonarse sin contraseña (público).
# Si la instancia ya tiene el proyecto, hace git pull y vuelve a instalar.
# =============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
awst() { aws "$@" --output text | tr -d '\r'; }

fail() { echo "❌ $*" >&2; exit 1; }

REPO="${1:-}"
[ -n "$REPO" ] || fail "Falta la URL del repositorio. Uso: bash deploy/aws-install.sh https://github.com/USUARIO/streamlab.git"
[[ "$REPO" =~ ^https://[^[:space:]\'\"\;\&\|\`\$]+$ ]] || fail "La URL debe empezar con https:// y no llevar espacios ni símbolos raros."

KEY_FILE="$HOME/.ssh/streamlab-key.pem"
ENV_FILE="$HOME/streamlab-aws.env"
[ -f "$ENV_FILE" ] || fail "No existe $ENV_FILE. Primero ejecuta: bash deploy/aws-create.sh"
[ -f "$KEY_FILE" ] || fail "No existe la llave $KEY_FILE. Primero ejecuta: bash deploy/aws-create.sh"
command -v ssh >/dev/null || fail "No se encontró ssh (viene con Git Bash)."
# shellcheck disable=SC1090
source "$ENV_FILE"
IP="${IP:-}"
[ -n "$IP" ] || fail "No hay IP en $ENV_FILE (la creación no terminó). Revisa: bash deploy/aws-create.sh"

SSH_OPTS=(-i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=30)

echo "==> Conectando con ubuntu@$IP"
OK=0
for i in 1 2 3 4 5 6; do
  if ssh "${SSH_OPTS[@]}" "ubuntu@$IP" true 2>/tmp/streamlab-ssh.err; then OK=1; break; fi
  echo "    intento $i/6 sin éxito, reintentando en 10 s…"; sleep 10
done
if [ "$OK" != 1 ]; then
  cat /tmp/streamlab-ssh.err >&2 || true
  fail "No se pudo conectar por SSH. Causas comunes: tu IP pública cambió (agrega una regla de puerto 22 con tu IP nueva) o 'UNPROTECTED PRIVATE KEY FILE' (ver DEPLOY.md → errores comunes)."
fi

echo "==> Instalando StreamLab (tarda unos minutos)"
REPO_Q=$(printf '%q' "$REPO")
ssh "${SSH_OPTS[@]}" "ubuntu@$IP" "set -e
if [ -d streamlab/.git ]; then cd streamlab && git pull --ff-only; else git clone $REPO_Q streamlab && cd streamlab; fi
bash deploy/setup-ec2.sh" || fail "La instalación falló. Si fue en 'git clone', revisa que el repositorio sea público y la URL correcta."

echo ""
echo "============================================================"
echo "   Web: http://$IP"
echo "   OBS: rtmp://$IP:1935/live"
echo "============================================================"
echo "📸 CAPTURA 3: navegador con http://$IP abierta (página principal de StreamLab)"
echo "Siguiente paso: bash deploy/smoke-test.sh $IP"
