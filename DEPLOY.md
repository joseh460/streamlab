# DEPLOY.md · Desplegar StreamLab en AWS (guía para la Persona B)

Para Windows + **Git Bash**. No hace falta tocar código: solo ejecutar los scripts de `deploy/` en orden.

> ⚠ **Estado de las pruebas:** los scripts `aws-create.sh`, `aws-install.sh` y `aws-destroy.sh` **no han sido probados contra AWS real por quien los escribió** (no había cuenta AWS). Se validaron con `bash -n` (sintaxis). `smoke-test.sh` sí se probó contra una copia local de la app. Si un script falla, el mensaje dice qué revisar; copia el error completo y avisa a la Persona A.
> `setup-ec2.sh` está tomado del Anexo B del manual y tampoco se ejecutó en una EC2 real.

## 0. Requisitos
- **Git Bash** (viene con Git para Windows) y **AWS CLI v2** instalada (`aws --version`).
- Una **cuenta AWS** con créditos y tu correo para las alertas.
- La **URL pública (https) del repositorio de GitHub** con el código (te la da la Persona A). Debe poder clonarse sin contraseña.
- Opcional: OBS Studio y/o ffmpeg en tu PC para transmitir de prueba.

## 1. Paso manual en la consola de AWS (una sola vez)
1. **IAM → Usuarios → Crear usuario** `streamlab-cli`, con las políticas `AmazonEC2FullAccess` y `AmazonSSMReadOnlyAccess`.
2. En ese usuario: **Credenciales de seguridad → Crear clave de acceso → Interfaz de línea de comandos (CLI)**. Guarda la *Access key* y la *Secret key*.
3. **Facturación → Presupuestos → Crear presupuesto → plantilla "Zero spend budget"** con tu correo. **Hazlo antes de crear recursos.**
4. En Git Bash:
   ```bash
   aws configure        # Access key, Secret key, región: us-east-1, formato: json
   aws sts get-caller-identity
   ```
   `get-caller-identity` debe mostrar tu cuenta y el usuario `streamlab-cli`.

📸 **Capturas:** el presupuesto "Zero spend" creado.

## 2. Orden de ejecución
Abre Git Bash **dentro de la carpeta del proyecto** (`git clone <URL_DEL_REPO>` y `cd streamlab`).

| Paso | Comando | Qué hace |
|---|---|---|
| 1 | `bash deploy/aws-create.sh` | Crea llave SSH, grupo de seguridad y la instancia `t3.micro` (tarda 2-3 min). Guarda los datos en `~/streamlab-aws.env`. |
| 2 | `bash deploy/aws-install.sh <URL_DEL_REPO>` | Entra por SSH, clona el repo e instala todo (`setup-ec2.sh`). Al final imprime la web y la URL de OBS. |
| 3 | `bash deploy/smoke-test.sh <IP>` | Comprueba que el servidor responde. |
| 4 | `bash deploy/smoke-test.sh <IP> USUARIO CLAVE` | (Opcional) Además transmite 15 s y comprueba el video. Necesita ffmpeg en tu PC. |
| Final | `bash deploy/aws-destroy.sh` | **Elimina todo.** Pide escribir `ELIMINAR`. |

Los scripts de AWS comprueban que `aws` funcione y que la región sea `us-east-1`; si no, se detienen con un mensaje claro. `aws-create.sh` **nunca sobrescribe**: si ya existe `~/streamlab-aws.env` o la llave, avisa y termina.

**Probar la app:** abre `http://IP` en tu PC y en el celular (con datos móviles), regístrate, entra a **Mi canal** y copia el servidor y la clave a OBS (Ajustes → Emisión → Personalizado). Transmite, y pide a alguien que entre, chatee y te siga.

## 3. Capturas para el reporte
Los scripts imprimen líneas `📸 CAPTURA n` en el momento exacto.

| # | Qué capturar | Cuándo |
|---|---|---|
| — | Presupuesto "Zero spend" | Paso 1.3 |
| 1 | Grupo de seguridad `streamlab-sg` con reglas 22, 80 y 1935 | Fin de la creación del grupo (`aws-create.sh`) |
| 2 | Instancia `streamlab` en ejecución, comprobaciones 2/2 | Al terminar `aws-create.sh` |
| — | Salida de `setup-ec2.sh` ("StreamLab está en línea") y de `pm2 status` | Dentro de `aws-install.sh` / por SSH |
| 3 | Navegador con `http://IP` mostrando StreamLab | Al terminar `aws-install.sh` |
| 4 | Canal en directo con video, chat y contador de espectadores | Durante la transmisión desde OBS |
| — | Lista de verificación (10 pruebas) hecha sobre la IP pública | Paso "Probar la app" |
| 5 | Instancia en estado **Terminada** (`terminated`) | Final de `aws-destroy.sh` |
| — | Consola de Facturación con el costo final | Unas horas después de eliminar |

## 4. Conectarte por SSH
```bash
source ~/streamlab-aws.env
ssh -i ~/.ssh/streamlab-key.pem ubuntu@$IP
```
Dentro del servidor: `pm2 status`, `pm2 logs streamlab` (Ctrl+C para salir), `df -h /` (los VOD ocupan disco).

## 5. Actualizar la app
Cuando la Persona A suba cambios a GitHub:
```bash
source ~/streamlab-aws.env
ssh -i ~/.ssh/streamlab-key.pem ubuntu@$IP "cd streamlab && git pull && npm ci --omit=dev && pm2 restart streamlab"
```
No edites archivos en el servidor (el siguiente `git pull` fallaría).

## 6. Pausar y reanudar la instancia
```bash
source ~/streamlab-aws.env
aws ec2 stop-instances --instance-ids $INSTANCE_ID          # pausar
aws ec2 start-instances --instance-ids $INSTANCE_ID         # reanudar
export MSYS_NO_PATHCONV=1
awst() { aws "$@" --output text | tr -d '\r'; }
awst ec2 describe-instances --instance-ids $INSTANCE_ID --query "Reservations[0].Instances[0].PublicIpAddress"
```
⚠ **La IP pública cambia** al reanudar. Usa la IP nueva (el panel mostrará la nueva dirección para OBS) y actualiza `IP=` en `~/streamlab-aws.env`. Si el SSH deja de funcionar, mira "IP cambiada" abajo. PM2 levanta la app solo al reiniciar.

## 7. Errores comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `Invalid id: "i-0abc...\r"` | `aws.exe` devuelve `\r` al final de cada línea | Usa `awst` (los scripts ya lo hacen): `awst() { aws "$@" --output text \| tr -d '\r'; }` |
| Rutas convertidas a `C:/Program Files/Git/...` | Git Bash convierte argumentos que empiezan con `/` | `export MSYS_NO_PATHCONV=1` (los scripts ya lo hacen; hazlo también si escribes comandos a mano) |
| `UNPROTECTED PRIVATE KEY FILE` | La llave `.pem` tiene permisos demasiado abiertos en Windows | `icacls "$(cygpath -w ~/.ssh/streamlab-key.pem)" /inheritance:r /grant:r "$USERNAME:R"` |
| SSH se queda esperando / `Connection timed out` | Tu IP pública cambió (otra red o router) y el puerto 22 solo acepta la anterior | Obtén tu IP: `curl -s https://checkip.amazonaws.com`. Agrega regla: `source ~/streamlab-aws.env; aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr TU_IP/32` |
| `aws-create.sh` dice "ya existe…" | Hay un despliegue anterior (archivo local o recursos en AWS) | `bash deploy/aws-destroy.sh` y vuelve a empezar |
| Error en `git clone` dentro de `aws-install.sh` | Repositorio privado o URL incorrecta | Usa el repositorio público y la URL `https://github.com/USUARIO/streamlab.git` |
| La app no responde tras instalar | Proceso caído | Por SSH: `pm2 logs streamlab` y `pm2 restart streamlab` |
| Se llenó el disco (los VOD pesan) | Muchas grabaciones | Por SSH: `df -h /` y borra videos viejos en `~/streamlab/media/live/<usuario>/*.mp4` |
| `Unable to locate credentials` / "región incorrecta" | `aws configure` sin hacer o región distinta | `aws configure` con región `us-east-1` |

El puerto 8000 que abre internamente `node-media-server` **no** se abre en el grupo de seguridad; no hace falta.

## 8. Costos (verifica los precios antes de empezar)
- `t3.micro`: ≈ **0.0104 USD/hora**.
- IPv4 pública: ≈ **0.005 USD/hora**.
- Disco gp3 de 10 GB: centavos al mes. La transferencia de salida (espectadores) se cobra aparte pasado el uso gratuito.
- Pausar la instancia deja de cobrar CPU, pero **el disco y la IP pública siguen costando**.

**Al terminar la práctica, elimina todo con `bash deploy/aws-destroy.sh`** y revisa la consola de Facturación para confirmar que no hay cargos nuevos.

---
Este proyecto no incluye Docker, HTTPS ni dominio propio (la web funciona en `http://`; algunos navegadores mostrarán "No seguro").
