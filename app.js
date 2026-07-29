/* ============================================================
   PANEL DE GUÍAS — lógica de la app
   Guarda la lista de guías pendientes en un archivo guias.json
   dentro de tu propio repo de GitHub, usando la API de Contents.
   ============================================================ */

const DATA_FILE = 'guias.json';
const CFG_KEY = 'panelGuiasConfig';

const el = (id) => document.getElementById(id);

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function configComplete(cfg) {
  return cfg.owner && cfg.repo && cfg.branch && cfg.token;
}

function apiUrl(cfg) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${DATA_FILE}`;
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

/* ---------- GitHub Contents API ---------- */

async function fetchGuiasFile(cfg) {
  const res = await fetch(`${apiUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (res.status === 404) {
    return { items: [], sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub respondió ${res.status} al leer ${DATA_FILE}`);
  }

  const data = await res.json();
  const content = b64DecodeUtf8(data.content.replace(/\n/g, ''));
  let items = [];
  try {
    items = JSON.parse(content);
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }
  return { items, sha: data.sha };
}

async function writeGuiasFile(cfg, items, sha, message) {
  const body = {
    message,
    content: b64EncodeUtf8(JSON.stringify(items, null, 2)),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl(cfg), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub respondió ${res.status} al guardar: ${t.slice(0, 200)}`);
  }
  return res.json();
}

/* ---------- Render ---------- */

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function render(items) {
  const area = el('listArea');
  el('listCount').textContent =
    items.length === 0 ? 'sin pendientes' : `${items.length} guía${items.length === 1 ? '' : 's'} pendiente${items.length === 1 ? '' : 's'}`;

  if (items.length === 0) {
    area.innerHTML = `
      <div class="empty">
        <strong>No hay guías pendientes</strong>
        Cargá un número arriba para empezar a rastrearlo.
      </div>`;
    return;
  }

  area.innerHTML = `<div class="cards">${items
    .map(
      (it) => `
      <div class="card" data-numero="${it.numero}">
        <div class="card-main">
          <div class="card-number">${it.numero}</div>
          <div class="card-date">agregado el ${fmtDate(it.agregado)}</div>
          <div class="route">
            <div class="track"></div>
            <div class="pkg">📦</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="status">En tránsito</span>
          <button class="remove-btn" title="Quitar de la lista" aria-label="Quitar guía ${it.numero}" data-remove="${it.numero}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>`
    )
    .join('')}</div>`;

  area.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeGuia(btn.getAttribute('data-remove')));
  });
}

/* ---------- State + actions ---------- */

let state = { items: [], sha: null };

async function refresh() {
  const cfg = loadConfig();
  if (!configComplete(cfg)) {
    el('listArea').innerHTML = `
      <div class="empty">
        <strong>Falta configurar la conexión</strong>
        Abrí el ⚙ de arriba y cargá tu usuario, repo, rama y token de GitHub.
      </div>`;
    el('listCount').textContent = '—';
    return;
  }
  el('listArea').innerHTML = `<p class="loading">Cargando guías…</p>`;
  try {
    const { items, sha } = await fetchGuiasFile(cfg);
    items.sort((a, b) => new Date(b.agregado) - new Date(a.agregado));
    state = { items, sha };
    render(items);
  } catch (err) {
    el('listArea').innerHTML = `<div class="empty"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

async function addGuia(numero) {
  const cfg = loadConfig();
  if (!configComplete(cfg)) {
    setFormMsg('Configurá primero la conexión con el ⚙ de arriba.', 'error');
    return;
  }
  if (state.items.some((it) => it.numero === numero)) {
    setFormMsg('Esa guía ya está en la lista.', 'error');
    return;
  }

  setAddBusy(true);
  try {
    const { items, sha } = await fetchGuiasFile(cfg); // por si cambió desde otra pestaña/acción
    const updated = [...items, { numero, agregado: new Date().toISOString() }];
    await writeGuiasFile(cfg, updated, sha, `Agregar guía ${numero}`);
    state = { items: updated, sha: null };
    render(updated);
    setFormMsg('Guía cargada. Va a revisarse en el próximo chequeo.', 'ok');
    el('guideInput').value = '';
  } catch (err) {
    setFormMsg(err.message, 'error');
  } finally {
    setAddBusy(false);
  }
}

async function removeGuia(numero) {
  const cfg = loadConfig();
  if (!configComplete(cfg)) return;
  try {
    const { items, sha } = await fetchGuiasFile(cfg);
    const updated = items.filter((it) => it.numero !== numero);
    await writeGuiasFile(cfg, updated, sha, `Quitar guía ${numero}`);
    state = { items: updated, sha: null };
    render(updated);
  } catch (err) {
    alert(`No se pudo quitar la guía: ${err.message}`);
  }
}

function setFormMsg(msg, kind) {
  const node = el('formMsg');
  node.textContent = msg;
  node.className = `form-msg ${kind || ''}`;
}

function setAddBusy(busy) {
  el('addBtn').disabled = busy;
  el('addBtn').textContent = busy ? 'Sellando…' : 'Sellar ▸';
}

/* ---------- Settings drawer ---------- */

function initDrawer() {
  const cfg = loadConfig();
  el('cfgOwner').value = cfg.owner || '';
  el('cfgRepo').value = cfg.repo || '';
  el('cfgBranch').value = cfg.branch || 'main';
  el('cfgToken').value = cfg.token || '';

  el('gearBtn').addEventListener('click', () => {
    el('drawer').classList.toggle('open');
    el('gearBtn').classList.add('spin');
    setTimeout(() => el('gearBtn').classList.remove('spin'), 600);
  });

  el('saveCfgBtn').addEventListener('click', () => {
    const cfg = {
      owner: el('cfgOwner').value.trim(),
      repo: el('cfgRepo').value.trim(),
      branch: el('cfgBranch').value.trim() || 'main',
      token: el('cfgToken').value.trim(),
    };
    saveConfig(cfg);
    el('cfgStatus').textContent = 'Guardado ✓';
    setTimeout(() => (el('cfgStatus').textContent = ''), 2000);
    refresh();
  });
}

/* ---------- Init ---------- */

el('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = el('guideInput').value.trim();
  if (!raw) {
    setFormMsg('Ingresá un número de guía.', 'error');
    return;
  }
  setFormMsg('', '');
  addGuia(raw);
});

initDrawer();
refresh();
