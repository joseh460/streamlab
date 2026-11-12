#!/usr/bin/env bash
# =============================================================
# StreamLab · Cambia el tipo de instancia EC2 (para la prueba de carga con muchos espectadores)
# Uso (en tu PC, Git Bash):  bash deploy/aws-resize.sh <tipo>      p. ej.  t3.large
#   Volver a la pequeña después:  bash deploy/aws-resize.sh t3.micro
# Detiene la instancia, cambia el tipo y la vuelve a encender. ¡La IP pública CAMBIA!
# La app arranca sola (PM2). Se actualiza la IP en ~/streamlab-aws.env.
# =============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
awst() { aws "$@" --output text | tr -d '\r'; }
fail() { echo "❌ $*" >&2; exit 1; }

TIPO="${1:-}"
[ -n "$TIPO" ] || fail "Falta el tipo. Uso: bash deploy/aws-resize.sh t3.large"
[[ "$TIPO" =~ ^[a-z0-9]+\.[a-z0-9]+$ ]] || fail "Tipo de instancia no válido: '$TIPO' (ejemplo: t3.large)"

ENV_FILE="$HOME/streamlab-aws.env"
[ -f "$ENV_FILE" ] || fail "No existe $ENV_FILE. Primero ejecuta: bash deploy/aws-create.sh"
command -v aws >/dev/null || fail "No se encontró AWS CLI."
# shellcheck disable=SC1090
source "$ENV_FILE"
[ -n "${INSTANCE_ID:-}" ] || fail "No hay INSTANCE_ID en $ENV_FILE."

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS CLI no tiene credenciales válidas. Ejecuta 'aws configure'."
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}}"
[ "$REGION" = "us-east-1" ] || fail "La región configurada es '${REGION:-ninguna}'. Debe ser us-east-1."

ACTUAL=$(awst ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].InstanceType") \
  || fail "No se pudo consultar la instancia $INSTANCE_ID."
echo "Instancia $INSTANCE_ID: tipo actual $ACTUAL → nuevo $TIPO"
[ "$ACTUAL" != "$TIPO" ] || { echo "Ya es de ese tipo. No se cambia nada."; exit 0; }
echo "Se apagará unos minutos (la web y las transmisiones se cortan) y la IP pública cambiará."
read -r -p "Escribe SI para continuar: " R
[ "$R" = "SI" ] || { echo "Cancelado."; exit 1; }

echo "==> Deteniendo…"
aws ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
echo "==> Cambiando el tipo a $TIPO"
aws ec2 modify-instance-attribute --instance-id "$INSTANCE_ID" --instance-type "{\"Value\": \"$TIPO\"}" \
  || { echo "❌ AWS rechazó el tipo (¿no existe en esta región o la cuenta no lo permite?). Reanudando con el tipo anterior…" >&2;
       aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null; exit 1; }
echo "==> Encendiendo…"
aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"
NUEVA_IP=$(awst ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].PublicIpAddress")
printf 'SG_ID=%s\nINSTANCE_ID=%s\nIP=%s\n' "${SG_ID:-}" "$INSTANCE_ID" "$NUEVA_IP" > "$ENV_FILE"

echo ""
echo "============================================================"
echo "   Tipo: $TIPO · IP pública NUEVA: $NUEVA_IP (guardada en $ENV_FILE)"
echo "   Web: http://$NUEVA_IP   OBS: rtmp://$NUEVA_IP:1935/live"
echo "============================================================"
echo "Comprueba: bash deploy/smoke-test.sh $NUEVA_IP"
echo "⚠ Si tu IP de casa también cambió, el SSH necesitará una regla nueva en el puerto 22 (ver DEPLOY.md)."
echo "📸 CAPTURA: consola AWS → EC2 → Instancias, columna 'Tipo de instancia' con el tipo nuevo"
