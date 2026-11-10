# Reporte · StreamLab (máx. 5 páginas, exportar a PDF)

> Plantilla: todo lo marcado `[COMPLETAR]` lo llena el equipo con datos **reales**. No inventes mediciones, costos ni capturas.

## 1. Portada y resumen
- Proyecto: StreamLab · Plataforma de streaming en vivo (RTMP → HLS) desplegada en AWS EC2
- Integrantes: [COMPLETAR]
- Materia / profesor / fecha: [COMPLETAR]
- URL del repositorio: [COMPLETAR]
- IP pública usada (ya eliminada): [COMPLETAR]
- Resumen (5-8 líneas: qué se construyó, cómo se desplegó, resultado): [COMPLETAR]

## 2. Lista de verificación en AWS (con capturas)
Repetir las 10 pruebas sobre la IP pública de AWS y pegar la captura de cada una (ver tabla de capturas en `DEPLOY.md`).

| # | Prueba | Resultado en AWS | Captura |
|---|---|---|---|
| 1 | Registrar usuario con nombre inválido | [COMPLETAR] | [COMPLETAR] |
| 2 | Transmitir con clave incorrecta (rechazada) | [COMPLETAR] | [COMPLETAR] |
| 3 | Transmitir con clave correcta (EN VIVO con miniatura) | [COMPLETAR] | [COMPLETAR] |
| 4 | Reproducir el canal (video avanza) | [COMPLETAR] | [COMPLETAR] |
| 5 | Dos navegadores: contador de espectadores = 2 | [COMPLETAR] | [COMPLETAR] |
| 6 | Chat entre dos usuarios | [COMPLETAR] | [COMPLETAR] |
| 7 | Chat sin sesión | [COMPLETAR] | [COMPLETAR] |
| 8 | Seguirse a sí mismo / seguir a otro | [COMPLETAR] | [COMPLETAR] |
| 9 | Detener OBS: pantalla "desconectado" y VOD nuevo | [COMPLETAR] | [COMPLETAR] |
| 10 | Regenerar clave (la anterior deja de funcionar) | [COMPLETAR] | [COMPLETAR] |

Otras capturas de infraestructura: presupuesto "Zero spend" [COMPLETAR] · grupo de seguridad [COMPLETAR] · instancia en ejecución 2/2 [COMPLETAR] · `pm2 status` [COMPLETAR].

## 3. Uso de IA: prompts y número de intentos
Tabla tomada de `PROMPTS_LOG.md` (no modificarla para que "salga mejor").

| Fase | Archivo | Prompt (resumen) | Modelo | Intentos | Correcciones |
|---|---|---|---|---|---|
| [COMPLETAR desde PROMPTS_LOG.md] | | | | | |

- Total de prompts numerados usados: [COMPLETAR]
- Total de intentos: [COMPLETAR]
- Reflexión breve sobre qué funcionó y qué hubo que corregir a mano: [COMPLETAR]

## 4. Costo final
Captura de la consola de Facturación (Billing and Cost Management → Facturas / Cost Explorer), unas horas después de eliminar los recursos.

| Concepto | Valor |
|---|---|
| Horas de instancia encendida | [COMPLETAR] |
| Costo total mostrado por AWS (USD) | [COMPLETAR] |
| Captura de facturación | [COMPLETAR] |

## 5. Evidencia de recursos eliminados
- Captura de la instancia en estado **Terminada** (`terminated`): [COMPLETAR]
- Confirmación de que el grupo de seguridad y el key pair ya no existen: [COMPLETAR]
- Fecha y hora de eliminación: [COMPLETAR]

## 6. Preguntas de reflexión

### 6.1 Latencia
Medir 5 veces la latencia (retraso entre lo que pasa en OBS y lo que se ve en el navegador) para cada valor de `hls_time` (1, 2 y 4 s). Para cambiar el valor, editar `hlsFlags` en `server.js` y reiniciar.

| `hls_time` | M1 (s) | M2 (s) | M3 (s) | M4 (s) | M5 (s) | Media (s) | Desv. estándar (s) |
|---|---|---|---|---|---|---|---|
| 1 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 2 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 4 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |

- Método de medición usado (p. ej. reloj visible en OBS vs. reloj en el navegador): [COMPLETAR]
- Análisis: [COMPLETAR]

### 6.2 ¿Por qué no se recodifica el video?
(Pista: el servidor usa `-c:v copy`. Piensa en CPU, memoria de la `t3.micro`, calidad y latencia.) [COMPLETAR]

### 6.3 Costo de transferencia para 50, 500 y 5 000 espectadores durante 2 h
Fórmula: **datos (GB) = bitrate (Mbps) × espectadores × tiempo (s) ÷ 8 ÷ 1000**.
Precio de transferencia de salida de AWS usado y fuente/fecha: [COMPLETAR]

| Espectadores | Bitrate total del video (Mbps) | Datos (GB) | Costo estimado (USD) |
|---|---|---|---|
| 50 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 500 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |
| 5 000 | [COMPLETAR] | [COMPLETAR] | [COMPLETAR] |

Comentario (¿sería viable con una sola `t3.micro`? ¿qué cambiaría?): [COMPLETAR]

### 6.4 Aporte del streaming a una plataforma multicontenido
[COMPLETAR]

### 6.5 Riesgo de poner la clave de transmisión en la URL pública
(Pista: StreamLab valida la clave en `prePublish` y la URL pública de reproducción no la contiene. ¿Qué pasaría si estuviera en una URL visible, en logs o en capturas?) [COMPLETAR]
