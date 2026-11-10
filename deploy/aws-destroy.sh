#!/usr/bin/env bash
# =============================================================
# StreamLab · ELIMINA todo lo creado en AWS (Paso 19B del manual)
# Uso (en tu PC, Git Bash):  bash deploy/aws-destroy.sh
# Termina la instancia, borra el grupo de seguridad y el key pair,
# y borra ~/.ssh/streamlab-key.pem y ~/streamlab-aws.env
# =============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
awst() { aws "$@" --output text | tr -d '\r'; }

fail() { echo "❌ $*" >&2; exit 1; }

KEY_NAME="streamlab-key"
SG_NAME="streamlab-sg"
KEY_FILE="$HOME/.ssh/streamlab-key.pem"
ENV_FILE="$HOME/streamlab-aws.env"

command -v aws >/dev/null || fail "No se encontró AWS CLI."
ACCOUNT=$(awst sts get-caller-identity --query Account) || fail "AWS CLI no tiene credenciales válidas. Ejecuta 'aws configure'."
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}}"
[ "$REGION" = "us-east-1" ] || fail "La región configurada es '${REGION:-ninguna}'. Debe ser us-east-1."

# Localiza los recursos: primero por el archivo guardado; si no, por nombre/etiqueta
SG_ID=""; INSTANCE_ID=""
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  SG_ID="${SG_ID:-}"; INSTANCE_ID="${INSTANCE_ID:-}"
fi
if [ -z "$INSTANCE_ID" ]; then
  INSTANCE_ID=$(awst ec2 describe-instances \
    --filters "Name=tag:Name,Values=streamlab" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query "Reservations[].Instances[].InstanceId" 2>/dev/null || true)
fi
if [ -z "$SG_ID" ]; then
  SG_ID=$(awst ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
    --query "SecurityGroups[0].GroupId" 2>/dev/null || true)
  [ "$SG_ID" != "None" ] || SG_ID=""
fi

echo "Cuenta AWS: $ACCOUNT · Región: $REGION"
echo "Se eliminarán (de forma PERMANENTE):"
echo "  - Instancia(s) EC2:   ${INSTANCE_ID:-(ninguna encontrada)}"
echo "  - Grupo de seguridad: ${SG_ID:-(ninguno encontrado)}"
echo "  - Key pair:           $KEY_NAME   y los archivos $KEY_FILE y $ENV_FILE"
echo "Los videos grabados (VOD) de la instancia se perderán."
read -r -p "Escribe ELIMINAR (en mayúsculas) para confirmar: " RESP
[ "$RESP" = "ELIMINAR" ] || { echo "Cancelado. No se eliminó nada."; exit 1; }

if [ -n "$INSTANCE_ID" ]; then
  echo "==> Terminando la instancia ($INSTANCE_ID)"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $INSTANCE_ID >/dev/null
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID
  echo "    Instancia terminada."
fi

if [ -n "$SG_ID" ]; then
  echo "==> Borrando el grupo de seguridad ($SG_ID)"
  DONE=0
  for i in 1 2 3 4 5 6; do
    if aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null; then DONE=1; break; fi
    echo "    AWS aún lo está liberando, reintento $i/6 en 10 s…"; sleep 10
  done
  [ "$DONE" = 1 ] || echo "⚠ No se pudo borrar el grupo de seguridad $SG_ID. Bórralo a mano en la consola (EC2 → Grupos de seguridad)."
fi

echo "==> Borrando el key pair y los archivos locales"
aws ec2 delete-key-pair --key-name "$KEY_NAME" >/dev/null 2>&1 || echo "    (el key pair ya no existía)"
rm -f "$KEY_FILE" "$ENV_FILE"

echo ""
echo "============================================================"
echo "   Recursos eliminados. Estado final de la instancia:"
if [ -n "$INSTANCE_ID" ]; then
  # shellcheck disable=SC2086
  aws ec2 describe-instances --instance-ids $INSTANCE_ID \
    --query "Reservations[].Instances[].[InstanceId,State.Name]" --output table
fi
echo "============================================================"
echo "📸 CAPTURA 5: consola AWS → EC2 → Instancias con 'streamlab' en estado 'Terminada' (terminated), o esta tabla"
echo "Recuerda revisar la consola de Facturación unas horas después para confirmar que no hay cargos nuevos."
