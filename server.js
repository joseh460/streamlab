require('dotenv').config();
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { execFile } = require('node:child_process');
const { hashPassword, checkPassword } = require('./bcrypt-pool');
const { Server } = require('socket.io');
const NodeMediaServer = require('node-media-server');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const RTMP_PORT = parseInt(process.env.RTMP_PORT, 10) || 1935;
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const MEDIA = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(__dirname, 'media');
const NMS_HTTP_PORT = parseInt(process.env.NMS_HTTP_PORT, 10) || 8000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const RECORD_VOD = process.env.RECORD_VOD !== 'false';
const CATEGORIES = ['Videojuegos', 'Programación', 'Educación', 'Música', 'Charlas', 'Arte'];
const USER_RE = /^[a-z0-9_]{3,20}$/;
const SESSION_DAYS = 7;

fs.mkdirSync(MEDIA, { recursive: true });

// Reutiliza las sentencias SQL preparadas (evita compilarlas en cada petición)
const _stmts = new Map();
function prep(sql) { let s = _stmts.get(sql); if (!s) { s = db.prepare(sql); _stmts.set(sql, s); } return s; }

// Micro-caché de listados: absorbe avalanchas de peticiones iguales (se invalida al cambiar el estado en vivo)
const listCache = new Map();
function cached(key, ttlMs, fn) {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fn();
  listCache.set(key, { at: Date.now(), value });
  return value;
}

const app = express();
const server = http.createServer(app);
let io; // se crea en la PARTE 2

app.use(express.json());

// ---------- Utilidades ----------
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function userFromToken(token) {
  if (!token) return null;
  return prep(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.created_at > datetime('now', ?)`
  ).get(token, `-${SESSION_DAYS} days`) || null;
}

function newKey() { return 'sk_' + crypto.randomBytes(12).toString('hex'); }

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 70%, 65%)`;
}

function viewersOf(username) {
  if (!io) return 0;
  const room = io.sockets.adapter.rooms.get('ch:' + username);
  return room ? room.size : 0;
}

function thumbOf(username) {
  const f = path.join(MEDIA, 'live', username, 'thumb.jpg');
  try { return `/media/live/${username}/thumb.jpg?t=${Math.floor(fs.statSync(f).mtimeMs)}`; }
  catch { return null; }
}

// Fila de usuario + nº de seguidores en una sola consulta (evita 1 consulta por canal)
const SELECT_CHANNELS = `SELECT u.*, (SELECT COUNT(*) FROM follows f WHERE f.channel_id = u.id) AS followers FROM users u`;

function decorate(u) {
  const followers = u.followers ?? prep('SELECT COUNT(*) n FROM follows WHERE channel_id = ?').get(u.id).n;
  return {
    username: u.username,
    title: u.title,
    category: u.category,
    is_live: u.is_live,
    viewers: viewersOf(u.username),
    followers,
    thumb: u.is_live ? thumbOf(u.username) : null,
  };
}

function listVods(username) {
  const dir = path.join(MEDIA, 'live', username);
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, url: `/media/live/${username}/${f}`, size_mb: Math.round(st.size / 1048576 * 10) / 10, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ mtime, ...v }) => ({ ...v, date: new Date(mtime).toISOString() }));
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sl_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  prep('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  setSessionCookie(res, token);
}

// ---------- Middleware ----------
// Solo la API necesita saber quién es el usuario: los segmentos de video y los archivos
// estáticos (miles de peticiones por segundo con muchos espectadores) no consultan la BD.
app.use('/api', (req, res, next) => {
  req.token = parseCookies(req.headers.cookie).sl_token || null;
  req.user = userFromToken(req.token);
  next();
});

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  next();
}

// ---------- Estáticos ----------
app.use('/vendor/hls.js', express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist')));
app.use('/media', express.static(MEDIA, {
  setHeaders(res, file) {
    if (file.endsWith('.m3u8')) res.setHeader('Cache-Control', 'no-cache, no-store');
    else if (file.endsWith('.ts')) res.setHeader('Cache-Control', 'public, max-age=30'); // los segmentos nunca cambian
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API ----------
app.post('/api/register', async (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!USER_RE.test(username)) return res.status(400).json({ error: 'Usuario: 3-20 caracteres (letras minúsculas, números y _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña: mínimo 6 caracteres' });
  if (prep('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  try {
    const hash = await hashPassword(password); // en un hilo aparte: no bloquea el servidor
    const r = prep(
      'INSERT INTO users (username, password_hash, stream_key, title, category) VALUES (?, ?, ?, ?, ?)'
    ).run(username, hash, newKey(), `Canal de ${username}`, 'Charlas');
    startSession(res, Number(r.lastInsertRowid));
    listCache.clear();
    res.json({ ok: true, username });
  } catch (e) {
    // Dos registros simultáneos del mismo usuario: gana el primero
    if (/UNIQUE/i.test(e.message)) return res.status(409).json({ error: 'Ese usuario ya existe' });
    console.error('[register]', e.message);
    res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
});

app.post('/api/login', async (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = prep('SELECT * FROM users WHERE username = ?').get(username);
  try {
    if (!u || !(await checkPassword(password, u.password_hash))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    startSession(res, u.id);
    res.json({ ok: true, username: u.username });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

app.post('/api/logout', (req, res) => {
  if (req.token) prep('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.setHeader('Set-Cookie', 'sl_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? { username: req.user.username } : null });
});

app.get('/api/categories', (req, res) => {
  res.json(cached('categories', 1000, () => {
    const rows = prep('SELECT category, COUNT(*) n FROM users WHERE is_live = 1 GROUP BY category').all();
    const live = Object.fromEntries(rows.map((r) => [r.category, r.n]));
    return CATEGORIES.map((name) => ({ name, live: live[name] || 0 }));
  }));
});

const MAX_CHANNELS = 300; // tope del listado: con miles de cuentas no se envía todo de golpe

app.get('/api/channels', (req, res) => {
  const category = req.query.category ? String(req.query.category) : '';
  const liveOnly = req.query.live === '1';
  res.json(cached(`channels|${category}|${liveOnly}`, 1000, () => {
    const where = [];
    const args = [];
    if (category) { where.push('u.category = ?'); args.push(category); }
    if (liveOnly) where.push('u.is_live = 1');
    const rows = prep(`${SELECT_CHANNELS} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.is_live DESC, u.username LIMIT ${MAX_CHANNELS}`).all(...args);
    return rows.map(decorate).sort((a, b) =>
      b.is_live - a.is_live || b.viewers - a.viewers || a.username.localeCompare(b.username));
  }));
});

app.get('/api/channels/:username', (req, res) => {
  const u = prep('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'Canal no encontrado' });
  const following = req.user
    ? !!prep('SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?').get(req.user.id, u.id)
    : false;
  res.json({
    ...decorate(u),
    bio: u.bio,
    following,
    hls: `/media/live/${u.username}/index.m3u8`,
    vods: listVods(u.username),
  });
});

app.post('/api/channels/:username/follow', auth, (req, res) => {
  const u = prep('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'Canal no encontrado' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
  const has = prep('SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?').get(req.user.id, u.id);
  if (has) prep('DELETE FROM follows WHERE follower_id = ? AND channel_id = ?').run(req.user.id, u.id);
  else prep('INSERT INTO follows (follower_id, channel_id) VALUES (?, ?)').run(req.user.id, u.id);
  const followers = prep('SELECT COUNT(*) n FROM follows WHERE channel_id = ?').get(u.id).n;
  res.json({ following: !has, followers });
});

app.get('/api/following', auth, (req, res) => {
  const rows = prep(
    'SELECT u.* FROM follows f JOIN users u ON u.id = f.channel_id WHERE f.follower_id = ?'
  ).all(req.user.id);
  res.json(rows.map(decorate).sort((a, b) => b.is_live - a.is_live || a.username.localeCompare(b.username)));
});

function dashboardOf(req, u) {
  return {
    username: u.username,
    title: u.title,
    category: u.category,
    bio: u.bio,
    is_live: u.is_live,
    obs_key: u.stream_key,
    rtmp_url: `rtmp://${PUBLIC_HOST || req.hostname}:${RTMP_PORT}/live`,
    categories: CATEGORIES,
  };
}

app.get('/api/dashboard', auth, (req, res) => res.json(dashboardOf(req, req.user)));

app.put('/api/dashboard', auth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title ?? req.user.title).trim().slice(0, 100);
  const category = String(b.category ?? req.user.category);
  const bio = String(b.bio ?? req.user.bio).trim().slice(0, 500);
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoría no válida' });
  if (!title) return res.status(400).json({ error: 'El título no puede estar vacío' });
  prep('UPDATE users SET title = ?, category = ?, bio = ? WHERE id = ?').run(title, category, bio, req.user.id);
  listCache.clear();
  if (io) io.to('ch:' + req.user.username).emit('channel:update', { title, category });
  res.json(dashboardOf(req, prep('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.post('/api/dashboard/regenerate-key', auth, (req, res) => {
  const key = newKey();
  prep('UPDATE users SET stream_key = ? WHERE id = ?').run(key, req.user.id);
  res.json({ obs_key: key });
});

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

app.get('/api/health', (req, res) => {
  const cpu = process.cpuUsage();
  const body = {
    ok: true,
    uptime: Math.round(process.uptime()),
    live: prep('SELECT COUNT(*) n FROM users WHERE is_live = 1').get().n,
    sockets: io ? io.engine.clientsCount : 0,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    cpu_s: Math.round((cpu.user + cpu.system) / 1e5) / 10,
    loop_p99_ms: Math.round(loopDelay.percentile(99) / 1e5) / 10,
    loop_max_ms: Math.round(loopDelay.max / 1e5) / 10,
  };
  if (req.query.reset === '1') loopDelay.reset();
  res.json(body);
});

app.get('/c/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'channel.html'));
});

// ---------- PARTE 2 ----------

// Socket.io
io = new Server(server);

// Avisa del nº de espectadores como máximo 2 veces por segundo y canal (con cientos de entradas
// simultáneas, emitirlo en cada una multiplicaría los mensajes por el tamaño de la sala).
const viewerTimers = new Map();
function announceViewers(name) {
  if (viewerTimers.has(name)) return;
  viewerTimers.set(name, setTimeout(() => {
    viewerTimers.delete(name);
    io.to('ch:' + name).emit('viewers', viewersOf(name));
  }, 500));
}

io.on('connection', (socket) => {
  const user = userFromToken(parseCookies(socket.handshake.headers.cookie).sl_token);
  socket.data.user = user;
  socket.data.channel = null;
  socket.data.last = 0;

  socket.on('join', (canal) => {
    const name = String(canal || '').toLowerCase();
    if (!USER_RE.test(name)) return;
    if (socket.data.channel && socket.data.channel !== name) {
      const old = socket.data.channel;
      socket.leave('ch:' + old);
      announceViewers(old);
    }
    socket.data.channel = name;
    socket.join('ch:' + name);
    announceViewers(name);
  });

  socket.on('chat', (texto) => {
    if (!socket.data.user) return socket.emit('chat:error', 'Inicia sesión para chatear');
    if (!socket.data.channel) return;
    const text = String(texto || '').trim();
    if (!text) return;
    if (text.length > 300) return socket.emit('chat:error', 'Máximo 300 caracteres');
    const now = Date.now();
    if (now - socket.data.last < 700) return socket.emit('chat:error', 'Vas muy rápido, espera un momento');
    socket.data.last = now;
    const name = socket.data.user.username;
    io.to('ch:' + socket.data.channel).emit('chat', { user: name, text, color: colorFor(name), at: now });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) if (room.startsWith('ch:')) announceViewers(room.slice(3));
  });
});

// node-media-server 2.7.0
const trans = { app: 'live', vc: 'copy', ac: 'copy', hls: true,
  hlsFlags: '[hls_time=2:hls_list_size=4:hls_flags=delete_segments:hls_delete_threshold=10]' };
if (RECORD_VOD) { trans.mp4 = true; trans.mp4Flags = '[movflags=frag_keyframe+empty_moov]'; }

const nms = new NodeMediaServer({
  rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  // Barras normales: el muxer "tee" de ffmpeg trata "\" como escape (problema en Windows)
  http: { port: NMS_HTTP_PORT, mediaroot: MEDIA.replace(/\\/g, '/'), allow_origin: '*' },
  trans: { ffmpeg: FFMPEG, tasks: [trans] },
  logType: 1,
});

const publishing = new Map(); // id de sesión -> username
const thumbTimers = new Map(); // username -> intervalo

function makeThumb(username) {
  const dir = path.join(MEDIA, 'live', username);
  const src = path.join(dir, 'index.m3u8');
  if (!fs.existsSync(src)) return;
  execFile(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', path.join(dir, 'thumb.jpg')],
    (err) => { if (err) console.error('[thumb]', username, err.message); });
}

function userOfPath(streamPath) {
  const m = /^\/live\/([^/?]+)/.exec(streamPath || '');
  return m ? m[1].toLowerCase() : null;
}

nms.on('prePublish', (id, streamPath, args) => {
  const username = userOfPath(streamPath);
  const u = username && prep('SELECT stream_key FROM users WHERE username = ?').get(username);
  if (!u || !args || args.key !== u.stream_key) {
    console.log(`[rtmp] publicación rechazada (${username || 'usuario inválido'})`);
    const s = nms.getSession(id);
    if (s) s.reject();
  }
});

nms.on('postPublish', (id, streamPath) => {
  const username = userOfPath(streamPath);
  if (!username) return;
  publishing.set(id, username);
  prep('UPDATE users SET is_live = 1 WHERE username = ?').run(username);
  listCache.clear();
  io.emit('live', { username, live: true });
  console.log(`[rtmp] ${username} EN VIVO`);
  clearInterval(thumbTimers.get(username));
  setTimeout(() => makeThumb(username), 5000);
  thumbTimers.set(username, setInterval(() => makeThumb(username), 30000));
});

nms.on('donePublish', (id, streamPath) => {
  const username = publishing.get(id) || userOfPath(streamPath);
  if (!publishing.has(id)) return; // sesión rechazada: nunca estuvo en vivo
  publishing.delete(id);
  clearInterval(thumbTimers.get(username));
  thumbTimers.delete(username);
  prep('UPDATE users SET is_live = 0 WHERE username = ?').run(username);
  listCache.clear();
  io.emit('live', { username, live: false });
  console.log(`[rtmp] ${username} desconectado`);
});

// Arranque
prep('UPDATE users SET is_live = 0').run();
nms.run();
server.listen({ port: PORT, backlog: 1024 }, () => {
  console.log(`StreamLab web en http://localhost:${PORT}`);
  console.log(`StreamLab RTMP en rtmp://localhost:${RTMP_PORT}/live`);
});
