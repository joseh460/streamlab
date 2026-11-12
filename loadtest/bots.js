// Prueba de carga de StreamLab con "bots" espectadores.
// Uso:  node loadtest/bots.js --url http://localhost:3000 --channel alice --bots 200 --duration 60
// Opciones:
//   --url       URL base del servidor (por defecto http://localhost:3000)
//   --channel   canal que miran los bots (debe existir; para --hls debe estar EN VIVO)
//   --bots      número de bots (200)
//   --duration  segundos que se mantienen conectados tras el registro (60)
//   --ramp      bots nuevos por segundo (50). Usa un valor alto para simular una avalancha.
//   --chat      ms entre mensajes de chat de cada bot, 0 = no chatean (5000)
//   --hls       1 = además descargan index.m3u8 y los segmentos como un reproductor real (0)
// Cada bot: se registra, abre la página del canal (API), se conecta por Socket.io, entra al chat y chatea.
const { io } = require('socket.io-client');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const URL_BASE = (args.url || 'http://localhost:3000').replace(/\/$/, '');
const CHANNEL = args.channel || 'alice';
const BOTS = parseInt(args.bots || '200', 10);
const DURATION = parseInt(args.duration || '60', 10) * 1000;
const RAMP = parseFloat(args.ramp || '50');
const CHAT_MS = parseInt(args.chat || '5000', 10);
const HLS = args.hls === '1';
const DEBUG = args.debug === '1';
let debugShown = 0;
const RUN = Date.now().toString(36).slice(-5);
const T0 = performance.now();

const lat = {};   // nombre -> lista de ms
const err = {};   // nombre -> cantidad de errores
const cnt = { socketsConectados: 0, chatsEnviados: 0, chatsRecibidos: 0, segmentos: 0, bytesHls: 0 };
const rec = (k, ms) => (lat[k] ||= []).push(ms);
const bad = (k) => { err[k] = (err[k] || 0) + 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timed(name, fn) {
  const t = performance.now();
  try {
    const r = await fn();
    rec(name, performance.now() - t);
    return r;
  } catch (e) {
    bad(name + (e.message ? ': ' + String(e.message).slice(0, 40) : ''));
    return null;
  }
}

async function http(path, opts = {}) {
  const res = await fetch(URL_BASE + path, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

async function bot(i, stopAt) {
  const username = `bot${RUN}_${i}`.slice(0, 20);
  let cookie = '';
  const reg = await timed('registro', async () => {
    const res = await http('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'botpass123' }),
    });
    cookie = (res.headers.getSetCookie()[0] || '').split(';')[0];
    await res.arrayBuffer();
    return true;
  });
  if (!reg) return;
  const ch = await timed('api canal', async () => (await http('/api/channels/' + CHANNEL, { headers: { cookie } })).json());
  await timed('api lista canales', async () => (await http('/api/channels', { headers: { cookie } })).json());
  await timed('pagina /c/', async () => (await http('/c/' + CHANNEL)).arrayBuffer());

  // Socket.io
  const t0 = performance.now();
  const socket = io(URL_BASE, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
  const pending = new Map();
  socket.on('connect', () => { rec('socket conexion', performance.now() - t0); cnt.socketsConectados++; socket.emit('join', CHANNEL); });
  socket.on('connect_error', () => bad('socket conexion'));
  socket.on('disconnect', (r) => { if (performance.now() < stopAt) bad('socket caido: ' + r); });
  socket.on('chat', (m) => {
    cnt.chatsRecibidos++;
    if (m.user === username && pending.has(m.text)) { rec('chat ida-vuelta', performance.now() - pending.get(m.text)); pending.delete(m.text); }
  });
  socket.on('chat:error', () => bad('chat:error'));

  const tasks = [];
  if (CHAT_MS > 0) {
    tasks.push((async () => {
      await sleep(Math.random() * CHAT_MS);
      let n = 0;
      while (performance.now() < stopAt) {
        const text = `hola ${i}-${n++}`;
        pending.set(text, performance.now());
        socket.emit('chat', text); cnt.chatsEnviados++;
        await sleep(Math.max(800, CHAT_MS * (0.7 + Math.random() * 0.6)));
      }
    })());
  }
  if (HLS && ch && ch.is_live) {
    tasks.push((async () => {
      const seen = new Set();
      while (performance.now() < stopAt) {
        const pl = await timed('hls playlist', async () => (await http(ch.hls)).text());
        if (pl) {
          for (const line of pl.split('\n')) {
            if (line.endsWith('.ts') && !seen.has(line)) {
              seen.add(line);
              await timed('hls segmento', async () => {
                try {
                  const b = await (await http('/media/live/' + CHANNEL + '/' + line)).arrayBuffer();
                  cnt.segmentos++; cnt.bytesHls += b.byteLength;
                } catch (e) {
                  if (DEBUG && debugShown++ < 6) {
                    console.log('[debug] fallo en', line, '(' + e.message + ') a los', ((performance.now() - T0) / 1000).toFixed(1),
                      's; la lista decía:', pl.split('\n').filter((l) => l.endsWith('.ts')).join(','), '| este bot ya había visto', seen.size);
                  }
                  throw e;
                }
              });
            }
          }
        }
        await sleep(2000);
      }
    })());
  }
  await Promise.all(tasks);
  while (performance.now() < stopAt) await sleep(500);
  socket.close();
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

(async () => {
  console.log(`Bots: ${BOTS} · canal: ${CHANNEL} · ${URL_BASE} · duración: ${DURATION / 1000}s · ramp: ${RAMP}/s · chat: ${CHAT_MS}ms · hls: ${HLS ? 'sí' : 'no'}`);
  const start = performance.now();
  const stopAt = start + DURATION + (BOTS / RAMP) * 1000;
  const all = [];
  for (let i = 0; i < BOTS; i++) {
    all.push(bot(i, stopAt));
    await sleep(1000 / RAMP);
  }
  await Promise.all(all);
  const total = (performance.now() - start) / 1000;

  console.log(`\nTerminado en ${total.toFixed(1)} s · sockets conectados: ${cnt.socketsConectados}/${BOTS} · chats enviados/recibidos: ${cnt.chatsEnviados}/${cnt.chatsRecibidos} · HLS: ${cnt.segmentos} segmentos, ${(cnt.bytesHls / 1048576).toFixed(1)} MB (${(cnt.bytesHls * 8 / total / 1e6).toFixed(1)} Mbps medios)`);
  console.log('\noperación                    n    p50 ms   p95 ms   p99 ms   máx ms');
  for (const k of Object.keys(lat).sort()) {
    const a = lat[k];
    console.log(`${k.padEnd(24)} ${String(a.length).padStart(6)} ${pct(a, 0.5).toFixed(0).padStart(8)} ${pct(a, 0.95).toFixed(0).padStart(8)} ${pct(a, 0.99).toFixed(0).padStart(8)} ${Math.max(...a).toFixed(0).padStart(8)}`);
  }
  const errs = Object.entries(err);
  console.log(errs.length ? '\nERRORES:\n' + errs.map(([k, v]) => `  ${k}: ${v}`).join('\n') : '\nSin errores ✔');
  process.exit(errs.length ? 1 : 0);
})();
