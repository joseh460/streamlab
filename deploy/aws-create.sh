#!/usr/bin/env bash
# =============================================================
# StreamLab · Crea la infraestructura en AWS (Pasos 14 y 15 del manual)
# Uso (en tu PC, Git Bash):  bash deploy/aws-create.sh
# Crea: llave SSH, grupo de seguridad y una instancia t3.micro (Ubuntu 24.04).
# Guarda SG_ID, INSTANCE_ID e IP en ~/streamlab-aws.env
# =============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1                       # Git Bash: no convertir "/..." en rutas de Windows
awst() { aws "$@" --output text | tr -d '\r'; } # salida de texto sin el \r de Windows

fail() { echo "❌ $*" >&2; exit 1; }
trap 'echo "❌ Falló un paso. Si quedaron recursos creados, ejecuta: bash deploy/aws-destroy.sh" >&2' ERR

KEY_NAME="streamlab-key"
SG_NAME="streamlab-sg"
KEY_FILE="$HOME/.ssh/streamlab-key.pem"
ENV_FILE="$HOME/streamlab-aws.env"

echo "==> Comprobando requisitos"
command -v aws  >/dev/null || fail "No se encontró AWS CLI. Instálala (AWS CLI v2) y abre una Git Bash nueva."
command -v curl >/dev/null || fail "No se encontró curl."

# No sobrescribir nada existente
if [ -f "$ENV_FILE" ] || [ -f "$KEY_FILE" ]; then
  echo "⚠ Ya existe $ENV_FILE o $KEY_FILE: ya hay un despliegue creado."
  echo "  No se sobrescribe nada. Para empezar de cero ejecuta primero: bash deploy/aws-destroy.sh"
  trap - ERR; exit 1
fi

ACCOUNT=$(awst sts get-caller-identity --query Account) \
  || fail "AWS CLI no tiene credenciales válidas. Ejecuta 'aws configure' (ver DEPLOY.md, paso 1)."
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}}"
[ "$REGION" = "us-east-1" ] || fail "La región configurada es '${REGION:-ninguna}'. Debe ser us-east-1: ejecuta 'aws configure' y escribe us-east-1."
echo "    Cuenta AWS: $ACCOUNT · Región: $REGION"

# Recursos que ya existan en AWS con el mismo nombre (de un intento anterior)
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  fail "Ya existe en AWS un key pair '$KEY_NAME' (¿intento anterior?). Ejecuta: bash deploy/aws-destroy.sh"
fi
EXISTING_SG=$(awst ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" --query "SecurityGroups[0].GroupId" 2>/dev/null || true)
if [ -n "$EXISTING_SG" ] && [ "$EXISTING_SG" != "None" ]; then
  fail "Ya existe en AWS el grupo de seguridad '$SG_NAME' ($EXISTING_SG). Ejecuta: bash deploy/aws-destroy.sh"
fi

echo "==> 1/4 Llave SSH ($KEY_NAME)"
mkdir -p "$HOME/.ssh"
awst ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 --query KeyMaterial > "$KEY_FILE"
chmod 400 "$KEY_FILE"
echo "    Guardada en $KEY_FILE"

echo "==> 2/4 Grupo de seguridad ($SG_NAME)"
VPC_ID=$(awst ec2 describe-vpcs --filters Name=is-default,Values=true --query "Vpcs[0].VpcId")
[ -n "$VPC_ID" ] && [ "$VPC_ID" != "None" ] || fail "No hay VPC por defecto en us-east-1."
SG_ID=$(awst ec2 create-security-group --group-name "$SG_NAME" \
          --description "StreamLab web RTMP SSH" --vpc-id "$VPC_ID" --query GroupId)
MI_IP=$(curl -fs --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]') \
  || fail "No se pudo averiguar tu IP pública (¿sin Internet?)."
[[ "$MI_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "IP pública inesperada: '$MI_IP'"
echo "    VPC=$VPC_ID SG=$SG_ID MI_IP=$MI_IP"
# SSH solo desde tu IP; web y RTMP abiertos
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22   --cidr "$MI_IP/32"  >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80   --cidr 0.0.0.0/0    >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 1935 --cidr 0.0.0.0/0    >/dev/null
echo "📸 CAPTURA 1: consola AWS → EC2 → Grupos de seguridad → streamlab-sg → pestaña 'Reglas de entrada' (22, 80, 1935)"

echo "==> 3/4 Lanzando la instancia t3.micro (Ubuntu 24.04)"
AMI="resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
DISCO='[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":10,"VolumeType":"gp3"}}]'
INSTANCE_ID=$(awst ec2 run-instances \
  --image-id "$AMI" \
  --instance-type t3.micro \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --block-device-mappings "$DISCO" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=streamlab}]' \
  --query "Instances[0].InstanceId")
echo "    Instancia: $INSTANCE_ID"
# Guardamos ya lo creado, por si algo falla después
printf 'SG_ID=%s\nINSTANCE_ID=%s\nIP=\n' "$SG_ID" "$INSTANCE_ID" > "$ENV_FILE"

echo "==> 4/4 Esperando a que la instancia esté lista (2-3 minutos)"
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"
IP=$(awst ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].PublicIpAddress")
[ -n "$IP" ] && [ "$IP" != "None" ] || fail "La instancia no tiene IP pública."
printf 'SG_ID=%s\nINSTANCE_ID=%s\nIP=%s\n' "$SG_ID" "$INSTANCE_ID" "$IP" > "$ENV_FILE"

trap - ERR
echo ""
echo "============================================================"
echo "   Instancia lista · IP pública: $IP"
echo "   Datos guardados en $ENV_FILE"
echo "   Siguiente paso: bash deploy/aws-install.sh <URL_DEL_REPO>"
echo "============================================================"
echo "📸 CAPTURA 2: consola AWS → EC2 → Instancias: 'streamlab' en estado 'En ejecución' con 'Comprobaciones de estado 2/2'"
