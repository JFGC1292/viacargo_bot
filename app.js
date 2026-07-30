/* ============================================================
   PANEL DE GUÍAS — lógica de la app
   Guarda la lista de guías (pendientes + historial de entregadas) en
   un archivo guias.json dentro de tu propio repo de GitHub, usando la
   API de Contents.
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

function emptyData() {
  return { pendientes: [], entregadas: [] };
}

/** Acepta tanto el formato nuevo ({pendientes, entregadas}) como el
 *  formato viejo (array plano = pendientes), para no romper si algo
 *  quedó guardado con la versión anterior. */
function normalizeData(raw) {
  if (Array.isArray(raw)) return { pendientes: raw, entregadas: [] };
  return {
    pendientes: Array.isArray(raw?.pendientes) ? raw.pendientes : [],
    entregadas: Array.isArray(raw?.entregadas) ? raw.entregadas : [],
  };
}

async function fetchDataFile(cfg) {
  const res = await fetch(`${apiUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (res.status === 404) {
    return { data: emptyData(), sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub respondió ${res.status} al leer ${DATA_FILE}`);
  }

  const payload = await res.json();
  const content = b64DecodeUtf8(payload.content.replace(/\n/g, ''));
  let data = emptyData();
  try {
    data = normalizeData(JSON.parse(content));
  } catch {
    data = emptyData();
  }
  return { data, sha: payload.sha };
}

async function writeDataFile(cfg, data, sha, message) {
  const body = {
    message,
    content: b64EncodeUtf8(JSON.stringify(data, null, 2)),
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

function pendingCardHtml(it) {
  return `
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
    </div>`;
}

function deliveredCardHtml(it) {
  return `
    <div class="card card-delivered" data-numero="${it.numero}">
      <div class="card-main">
        <div class="card-number">${it.numero}</div>
        <div class="card-date">entregada el ${fmtDate(it.entregado_el)}</div>
      </div>
      <span class="status status-delivered">✓ Entregada</span>
    </div>`;
}

function render(data) {
  const { pendientes, entregadas } = data;
  const pendArea = el('listArea');
  el('listCount').textContent =
    pendientes.length === 0
      ? 'sin pendientes'
      : `${pendientes.length} guía${pendientes.length === 1 ? '' : 's'} pendiente${pendientes.length === 1 ? '' : 's'}`;

  if (pendientes.length === 0) {
    pendArea.innerHTML = `
      <div class="empty">
        <strong>No hay guías pendientes</strong>
        Cargá un número arriba para empezar a rastrearlo.
      </div>`;
  } else {
    pendArea.innerHTML = `<div class="cards">${pendientes.map(pendingCardHtml).join('')}</div>`;
    pendArea.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeGuia(btn.getAttribute('data-remove')));
    });
  }

  const delSection = el('deliveredSection');
  const delArea = el('deliveredArea');
  el('deliveredCount').textContent =
    entregadas.length === 0 ? '' : `${entregadas.length}`;

  if (entregadas.length === 0) {
    delSection.style.display = 'none';
  } else {
    delSection.style.display = '';
    const ordered = [...entregadas].sort(
      (a, b) => new Date(b.entregado_el || 0) - new Date(a.entregado_el || 0)
    );
    delArea.innerHTML = `<div class="cards">${ordered.map(deliveredCardHtml).join('')}</div>`;
  }
}

/* ---------- State + actions ---------- */

let state = { data: emptyData(), sha: null };

function allKnownNumeros() {
  return [...state.data.pendientes, ...state.data.entregadas].map((it) => it.numero);
}

async function refresh() {
  const cfg = loadConfig();
  if (!configComplete(cfg)) {
    el('listArea').innerHTML = `
      <div class="empty">
        <strong>Falta configurar la conexión</strong>
        Abrí el ⚙ de arriba y cargá tu usuario, repo, rama y token de GitHub.
      </div>`;
    el('listCount').textContent = '—';
    el('deliveredSection').style.display = 'none';
    return;
  }
  el('listArea').innerHTML = `<p class="loading">Cargando guías…</p>`;
  try {
    const { data, sha } = await fetchDataFile(cfg);
    data.pendientes.sort((a, b) => new Date(b.agregado) - new Date(a.agregado));
    state = { data, sha };
    render(data);
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
  if (allKnownNumeros().includes(numero)) {
    setFormMsg('Esa guía ya está cargada (pendiente o entregada).', 'error');
    return;
  }

  setAddBusy(true);
  try {
    const { data, sha } = await fetchDataFile(cfg); // por si cambió desde otra pestaña/acción
    if (data.pendientes.some((it) => it.numero === numero) || data.entregadas.some((it) => it.numero === numero)) {
      setFormMsg('Esa guía ya está cargada (pendiente o entregada).', 'error');
      return;
    }
    const updated = {
      pendientes: [...data.pendientes, { numero, agregado: new Date().toISOString() }],
      entregadas: data.entregadas,
    };
    await writeDataFile(cfg, updated, sha, `Agregar guía ${numero}`);
    state = { data: updated, sha: null };
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
    const { data, sha } = await fetchDataFile(cfg);
    const updated = {
      pendientes: data.pendientes.filter((it) => it.numero !== numero),
      entregadas: data.entregadas,
    };
    await writeDataFile(cfg, updated, sha, `Quitar guía pendiente ${numero}`);
    state = { data: updated, sha: null };
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
