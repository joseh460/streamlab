# DEPLOY.md · Desplegar StreamLab en AWS (guía para la Persona B)

Para Windows + **Git Bash**. No hace falta tocar código: solo ejecutar los scripts de `deploy/` en orden.

> ⚠ **Estado de las pruebas:** los scripts `aws-create.sh`, `aws-install.sh` y `aws-destroy.sh` **no han sido probados contra AWS real por quien los escribió** (no había cuenta AWS). Se validaron con `bash -n` (sintaxis). `smoke-test.sh` sí se probó contra una copia local de la app. Si un script falla, el mensaje dice qué revisar; copia el error completo y avisa a la Persona A.
> `setup-ec2.sh` viene del Anexo B del manual. Se ejecutó completo en un **contenedor Ubuntu 24.04** (Docker): instala Node 22, ffmpeg, PM2, abre el puerto 80 y deja la app en línea. En ese entorno no había systemd (el arranque automático de PM2 no se pudo comprobar) ni swap real. Allí apareció y se corrigió un fallo (`$USER` sin definir). **No se ha ejecutado en una EC2 real.**

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
| Opcional | `bash deploy/aws-resize.sh t3.large` | Cambia el tipo de instancia (p. ej. antes de la prueba de carga del profesor). La IP cambia. Ver sección 9. |
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

## 9. Prueba de carga: 200 espectadores o más (bots del profesor)

> **Qué está probado y qué no.** Las pruebas de carga se hicieron (a) en un **contenedor Ubuntu 24.04 limitado a 2 CPU y 4 GB** (lo más parecido a una EC2 de 2 vCPU que se pudo hacer sin AWS) y (b) en Windows con el servidor limitado a 2 núcleos. **No se hicieron en una EC2 real**: los números son una guía, no una garantía. Antes de la fecha de la prueba hay que repetirla sobre la EC2 (ver "Cómo medir"). Ojo: los CPU de una `t3` son más lentos y con créditos, así que espera algo peor que en el contenedor.

### Qué se mejoró en el código para aguantar carga
- **bcrypt en hilos aparte** (`bcrypt-pool.js`): antes cada registro/login congelaba el servidor ~80 ms (más en una `t3.micro`); 200 registros seguidos lo dejaban parado 16+ s. Se mantienen las 10 rondas de `SPEC.md`.
- Los **archivos de video ya no consultan la base de datos** (la autenticación solo corre en `/api`).
- Lista de canales en **una sola consulta** con micro-caché de 1 s; sentencias SQL reutilizadas; índices nuevos.
- El contador de espectadores se envía **como máximo 2 veces por segundo** por canal (antes, una vez por cada entrada).
- ffmpeg conserva en disco **10 segmentos HLS extra** (`hls_delete_threshold=10`), para que los clientes lentos no reciban 404.
- Límite de archivos abiertos alto (`ulimit -n 65535`) en `setup-ec2.sh`, y `backlog` de 1024 conexiones.
- `/api/health` ahora informa de `sockets`, `rss_mb`, `cpu_s` y `loop_p99_ms` (retraso del event loop: si pasa de ~500 ms, el servidor va justo).

### Resultados medidos en Linux (Ubuntu 24.04, servidor a 2 CPU) — la referencia
Servidor con PM2 desplegado con `setup-ec2.sh`; bots y emisor en otro contenedor. Video HLS + chat + registro de cada bot.

| Escenario | Resultado |
|---|---|
| **200 bots**, registro en avalancha 50/s, video 2,5 Mbps, chat cada 5 s | **200/200 conectados, 0 errores.** API de canal p95 89 ms; segmentos HLS p95 456 ms; chat de ida y vuelta p95 56 ms; event loop p99 52 ms; 486 Mbps de video entregados |
| **300 bots**, 20/s, video 1,5 Mbps, chat cada 10 s | **300/300, 0 errores.** API p95 207 ms; segmentos p95 617 ms; 384 Mbps |
| 500 bots, 20/s, 1,5 Mbps, chat cada 10 s | **Falla**: 259/500 sockets, 98 timeouts de registro, timeouts en HLS |
| 500 bots con `BCRYPT_ROUNDS=8` | Registro p50 **38 ms** (en vez de 6 s), pero sigue fallando: 390/500 sockets, timeouts de HLS |

**Conclusión: con 2 CPU Linux se aguantan al menos 300 espectadores con video sin errores (margen de 1,5× sobre los 200 pedidos); a 500 no.** El techo es el proceso Node (un solo hilo, ~1 CPU) sirviendo ~400 Mbps de video y miles de mensajes de chat por segundo. Si los bots no descargan video, aguanta bastante más. Lo que sigue en orden de impacto, si hiciera falta más: servir `/media` con nginx, y más CPU.

El punto débil con 2 CPU es el **registro**: con bcrypt de 10 rondas, 200–300 cuentas a la vez tardan p50 ≈ 4–6 s y p95 ≈ 9 s. Si los bots tienen un timeout corto, usa `BCRYPT_ROUNDS=8` (ver abajo).

### Resultados medidos en Windows (servidor en 2 núcleos, bots en el mismo PC) — antes y después de las mejoras
| Escenario | Antes | Después |
|---|---|---|
| 200 bots (registro en avalancha 50/s, socket, chat cada 5 s, video HLS 2,5 Mbps): API de canal p50 / p95 | 3108 ms / 11 280 ms | 38 ms / 412 ms |
| Retraso del event loop p99 (200 bots) | 1241 ms | 150–560 ms (según la corrida) |
| Sockets conectados (200 bots) | 167–200 | 200/200 |
| Registro p50 (200 simultáneos) | 4316 ms | ~1300–4300 ms (es CPU de bcrypt) |
| 500 bots | — | **No aguanta limpio** con 2 núcleos: hay timeouts de registro y segmentos 404 |

*(En Windows el límite salió más bajo por la limitación de abajo y porque bots y servidor compartían el PC; usa los resultados de Linux como referencia.)*

### Dos cosas que hay que saber
1. **Registro masivo.** Cada hash bcrypt (10 rondas) cuesta ~80 ms de CPU de *un núcleo*. Con 2 vCPU se pueden crear unas 15–25 cuentas por segundo; 200 bots registrándose a la vez tardan varios segundos. Si los bots del profesor tienen un timeout corto, se puede bajar el coste con `BCRYPT_ROUNDS=8` en `.env` (4 veces más rápido; las cuentas ya creadas siguen funcionando). Eso **cambia el "10 rondas" de SPEC.md**: decídelo con tu compañero/a.
2. **Ancho de banda.** Cada espectador de video consume el bitrate completo. 200 espectadores × 2,5 Mbps = **500 Mbps**; × 1,5 Mbps = 300 Mbps. Una `t3.micro` no sostiene eso. Recomendación para la fecha de la prueba: transmitir a **1000–1500 kbps** en OBS y usar una instancia de **2 vCPU con más red**, por ejemplo `t3.large` o `c6i.large` (verifica en la documentación de AWS el ancho de banda base de cada tipo y su precio).

### Cómo cambiar de instancia solo para la prueba
```bash
bash deploy/aws-resize.sh t3.large    # antes de la prueba (la IP pública cambia)
bash deploy/aws-resize.sh t3.micro    # después, para no gastar de más
```
(O elimina todo con `aws-destroy.sh` al terminar.) Este script **no se probó contra AWS real**.

### Cómo medir tú mismo
En tu PC, con `npm ci` hecho (incluye la herramienta de bots):
```bash
node loadtest/bots.js --url http://IP --channel USUARIO_QUE_TRANSMITE --bots 200 --duration 60 --ramp 20 --chat 10000 --hls 0
```
- `--hls 1` hace que cada bot descargue el video como un reproductor real: genera **cientos de Mbps de descarga**. Desde casa no lo aguantará tu internet; si hace falta probarlo, ejecuta los bots desde otra máquina con buena red.
- Mientras corre, vigila el servidor: `curl http://IP/api/health` (mira `sockets`, `cpu_s` y `loop_p99_ms`) y `pm2 monit` por SSH.
- Prueba completa contra la EC2 (crea un usuario emisor, transmite un canal de prueba y lanza los bots): `bash loadtest/run-remote.sh http://IP IP 200 60 1 20 10000` (URL, host RTMP, bots, segundos, video 0/1, bots por segundo, ms entre chats; `VIDEO_KBPS=1500` por defecto). Necesita ffmpeg y buena red en la máquina que lanza los bots.
- Prueba local aislada (no toca tu servidor ni tu BD): `bash loadtest/run-local.sh 200 40 1 50 5000` (bots, segundos, video 0/1, bots por segundo, ms entre chats). En Windows, `SERVER_CORES=2` limita el servidor a 2 núcleos.

### Costo aproximado de la prueba (verifica precios)
La transferencia de salida es lo que más pesa: 200 espectadores a 1,5 Mbps durante 1 hora son ≈ **135 GB**. A unos 0,09 USD/GB tras el primer tramo gratuito, serían del orden de unos pocos USD. Súmale unas horas de instancia más grande. Esto alimenta la pregunta 6.3 de `REPORTE_PLANTILLA.md`.

### Limitación conocida de las pruebas en Windows
Al probar con cientos de bots en **Windows**, ffmpeg no puede reemplazar `index.m3u8` mientras se está leyendo: la lista de reproducción se queda congelada y aparecen errores 404 en segmentos. **En Linux no ocurre** (comprobado en el contenedor Ubuntu: 0 errores con 200 y 300 bots), así que en la EC2 no debería verse.
