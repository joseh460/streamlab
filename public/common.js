// Funciones globales compartidas por todas las páginas.

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try { res = await fetch(url, init); }
  catch { throw new Error('No se pudo conectar con el servidor'); }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function colorFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 70%, 65%)`;
}

function avatar(name, cls = '') {
  const n = String(name || '?');
  return `<span class="avatar ${cls}" style="background:${colorFor(n)}">${esc(n.charAt(0))}</span>`;
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2500);
}

// Pinta la barra superior y devuelve el usuario actual (o null).
async function renderTopbar(active) {
  let user = null;
  try { user = (await api('/api/me')).user; } catch { /* sin sesión */ }
  let bar = document.getElementById('topbar');
  if (!bar) {
    bar = document.createElement('header');
    bar.id = 'topbar';
    document.body.prepend(bar);
  }
  bar.className = 'topbar';
  const link = (key, href, text) => `<a href="${href}" class="${active === key ? 'active' : ''}">${text}</a>`;
  bar.innerHTML = `
    <a class="logo" href="/">Stream<span>Lab</span></a>
    <nav class="nav">
      ${link('explore', '/', 'Explorar')}
      ${user ? link('following', '/?tab=following', 'Siguiendo') : ''}
      ${user ? link('dashboard', '/dashboard.html', 'Mi canal') : ''}
    </nav>
    <div class="nav-right">
      ${user
        ? `<span class="muted">${avatar(user.username)} ${esc(user.username)}</span><button class="btn btn-sm" id="btn-logout">Salir</button>`
        : `<a class="btn btn-sm" href="/login.html">Iniciar sesión</a><a class="btn btn-sm btn-primary" href="/login.html#register">Registrarse</a>`}
    </div>`;
  const out = document.getElementById('btn-logout');
  if (out) out.onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignorar */ }
    location.href = '/';
  };
  return user;
}

// Lista lateral de canales (en vivo primero).
async function renderSidebar(el) {
  if (!el) return;
  try {
    const list = await api('/api/channels');
    el.innerHTML = '<h4>Canales</h4>' + (list.length
      ? list.map((c) => `
        <a class="side-item ${c.is_live ? '' : 'off'}" href="/c/${esc(c.username)}">
          ${avatar(c.username)}
          <span class="info"><div class="name">${esc(c.username)}</div>
          <div class="sub">${c.is_live ? esc(c.category) : 'Desconectado'}</div></span>
          ${c.is_live ? `<span class="dot"></span><span class="sub">${c.viewers}</span>` : ''}
        </a>`).join('')
      : '<div class="muted" style="padding:8px">Aún no hay canales</div>');
  } catch {
    el.innerHTML = '<h4>Canales</h4><div class="muted" style="padding:8px">No se pudo cargar</div>';
  }
}

function cardHTML(c) {
  const thumb = c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">` : `<span class="ph">${esc(c.username.charAt(0))}</span>`;
  return `
    <a class="card" href="/c/${esc(c.username)}">
      <div class="thumb">${thumb}
        <span class="badge ${c.is_live ? 'live' : 'off'}">${c.is_live ? 'EN VIVO' : 'OFFLINE'}</span>
        ${c.is_live ? `<span class="viewers-badge">${c.viewers} espectador${c.viewers === 1 ? '' : 'es'}</span>` : ''}
      </div>
      <div class="card-body">${avatar(c.username)}
        <div class="info"><div class="card-title">${esc(c.title || c.username)}</div>
        <div class="card-sub">${esc(c.username)} · ${esc(c.category)}</div></div>
      </div>
    </a>`;
}
