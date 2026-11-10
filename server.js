require('dotenv').config();
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const NodeMediaServer = require('node-media-server');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const RTMP_PORT = parseInt(process.env.RTMP_PORT, 10) || 1935;
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const MEDIA = path.join(__dirname, 'media');
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const RECORD_VOD = process.env.RECORD_VOD !== 'false';
const CATEGORIES = ['Videojuegos', 'Programación', 'Educación', 'Música', 'Charlas', 'Arte'];
const USER_RE = /^[a-z0-9_]{3,20}$/;
const SESSION_DAYS = 7;

fs.mkdirSync(MEDIA, { recursive: true });

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
  return db.prepare(
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

function decorate(u) {
  const followers = db.prepare('SELECT COUNT(*) n FROM follows WHERE channel_id = ?').get(u.id).n;
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
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  setSessionCookie(res, token);
}

// ---------- Middleware ----------
app.use((req, res, next) => {
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
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API ----------
app.post('/api/register', (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!USER_RE.test(username)) return res.status(400).json({ error: 'Usuario: 3-20 caracteres (letras minúsculas, números y _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña: mínimo 6 caracteres' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(
    'INSERT INTO users (username, password_hash, stream_key, title, category) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, newKey(), `Canal de ${username}`, 'Charlas');
  startSession(res, Number(r.lastInsertRowid));
  res.json({ ok: true, username });
});

app.post('/api/login', (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  startSession(res, u.id);
  res.json({ ok: true, username: u.username });
});

app.post('/api/logout', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.setHeader('Set-Cookie', 'sl_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? { username: req.user.username } : null });
});

app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT category, COUNT(*) n FROM users WHERE is_live = 1 GROUP BY category').all();
  const live = Object.fromEntries(rows.map((r) => [r.category, r.n]));
  res.json(CATEGORIES.map((name) => ({ name, live: live[name] || 0 })));
});

app.get('/api/channels', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.category) { where.push('category = ?'); args.push(String(req.query.category)); }
  if (req.query.live === '1') where.push('is_live = 1');
  const rows = db.prepare(`SELECT * FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...args);
  const list = rows.map(decorate).sort((a, b) =>
    b.is_live - a.is_live || b.viewers - a.viewers || a.username.localeCompare(b.username));
  res.json(list);
});

app.get('/api/channels/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'Canal no encontrado' });
  const following = req.user
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?').get(req.user.id, u.id)
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
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'Canal no encontrado' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND channel_id = ?').get(req.user.id, u.id);
  if (has) db.prepare('DELETE FROM follows WHERE follower_id = ? AND channel_id = ?').run(req.user.id, u.id);
  else db.prepare('INSERT INTO follows (follower_id, channel_id) VALUES (?, ?)').run(req.user.id, u.id);
  const followers = db.prepare('SELECT COUNT(*) n FROM follows WHERE channel_id = ?').get(u.id).n;
  res.json({ following: !has, followers });
});

app.get('/api/following', auth, (req, res) => {
  const rows = db.prepare(
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
  db.prepare('UPDATE users SET title = ?, category = ?, bio = ? WHERE id = ?').run(title, category, bio, req.user.id);
  if (io) io.to('ch:' + req.user.username).emit('channel:update', { title, category });
  res.json(dashboardOf(req, db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.post('/api/dashboard/regenerate-key', auth, (req, res) => {
  const key = newKey();
  db.prepare('UPDATE users SET stream_key = ? WHERE id = ?').run(key, req.user.id);
  res.json({ obs_key: key });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), live: db.prepare('SELECT COUNT(*) n FROM users WHERE is_live = 1').get().n });
});

app.get('/c/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'channel.html'));
});

// ---------- PARTE 2 ----------

// Socket.io
io = new Server(server);

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
      io.to('ch:' + old).emit('viewers', viewersOf(old));
    }
    socket.data.channel = name;
    socket.join('ch:' + name);
    io.to('ch:' + name).emit('viewers', viewersOf(name));
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
    for (const room of socket.rooms) {
      if (room.startsWith('ch:')) {
        const n = (io.sockets.adapter.rooms.get(room)?.size || 1) - 1;
        socket.to(room).emit('viewers', n);
      }
    }
  });
});

// node-media-server 2.7.0
const trans = { app: 'live', vc: 'copy', ac: 'copy', hls: true,
  hlsFlags: '[hls_time=2:hls_list_size=4:hls_flags=delete_segments]' };
if (RECORD_VOD) { trans.mp4 = true; trans.mp4Flags = '[movflags=frag_keyframe+empty_moov]'; }

const nms = new NodeMediaServer({
  rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  // Barras normales: el muxer "tee" de ffmpeg trata "\" como escape (problema en Windows)
  http: { port: 8000, mediaroot: MEDIA.replace(/\\/g, '/'), allow_origin: '*' },
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
  const u = username && db.prepare('SELECT stream_key FROM users WHERE username = ?').get(username);
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
  db.prepare('UPDATE users SET is_live = 1 WHERE username = ?').run(username);
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
  db.prepare('UPDATE users SET is_live = 0 WHERE username = ?').run(username);
  io.emit('live', { username, live: false });
  console.log(`[rtmp] ${username} desconectado`);
});

// Arranque
db.prepare('UPDATE users SET is_live = 0').run();
nms.run();
server.listen(PORT, () => {
  console.log(`StreamLab web en http://localhost:${PORT}`);
  console.log(`StreamLab RTMP en rtmp://localhost:${RTMP_PORT}/live`);
});
