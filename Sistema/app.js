const ASSET_BASE = 'https://raw.githubusercontent.com/rodrigostz89-debug/super-nintendo/main/';
const KV_BASE = 'https://keyvalue.immanuel.co/api/KeyVal';
const KV_APP = 'kmv7ro97';
const NTFY_BASE = 'https://ntfy.sh';
const EC_BASE = 'https://extendsclass.com/api/json-storage/bin';
const EC_MASTER_BIN = 'fbbcfba';

let allGames = [];
let filteredGames = [];
let userData = { favorites: [], recent: [] };
let cloudAccount = null; // { username, passHash, saves: { [gameId]: { b, n, t } | true } }
let currentGame = null;
let pendingCloudAction = null; // 'save' | 'load' | null
let pendingSaveBytes = null;
let activeFilter = 'all';
let activeLetter = 'ALL';
let searchQuery = '';

const gridEl = document.getElementById('gamesGrid');
const scrollEl = document.getElementById('gridScroll');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const summaryEl = document.getElementById('resultSummary');
const emuModal = document.getElementById('emuModal');
const emuFrame = document.getElementById('emuFrame');
const emuTitle = document.getElementById('emuTitle');
const toastEl = document.getElementById('toastMsg');
let toastTimer = null;

function showToast(msg, isError) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.borderColor = isError ? '#fa5252' : '#51cf66';
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 3800);
}

function cleanUsername(u) {
  return (u || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

async function hashPassword(user, pass) {
  const str = user + ':snes_salt_2026:' + pass;
  try {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
  } catch (e) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
}

function uint8ToBase64(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + chunk, len)));
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const clean = (b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toSafeB64Url(str) {
  return 'b64_' + btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromSafeB64Url(val) {
  if (typeof val !== 'string' || !val.startsWith('b64_')) return val;
  try {
    let b64 = val.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeURIComponent(escape(atob(b64)));
  } catch (e) {
    return val;
  }
}

function parseEcJson(rawText) {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText.split('<!')[0].trim());
  } catch (e) {
    return null;
  }
}

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_BASE}/GetValue/${KV_APP}/${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const val = await res.json();
    return val ? fromSafeB64Url(val) : null;
  } catch (e) {
    return null;
  }
}

async function kvSet(key, valStr) {
  try {
    const safeVal = toSafeB64Url(valStr);
    const res = await fetch(`${KV_BASE}/UpdateValue/${KV_APP}/${encodeURIComponent(key)}?value=${encodeURIComponent(safeVal)}`, {
      method: 'POST',
      headers: { 'Content-Length': '0' }
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function getNtfyAccountTopic(username) {
  return `snes_acc_${username}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getNtfySaveTopic(username, gameId, passHash) {
  return `snes_sav_${username}_${gameId}_${(passHash || '').slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function normalizeSavesMap(rawSaves) {
  const map = {};
  if (!rawSaves) return map;
  if (Array.isArray(rawSaves)) {
    for (const gid of rawSaves) {
      if (gid) map[gid] = true;
    }
  } else if (typeof rawSaves === 'object') {
    for (const [gid, val] of Object.entries(rawSaves)) {
      if (gid && val) map[gid] = val;
    }
  }
  return map;
}

function mergeSavesMaps(target, source) {
  const norm = normalizeSavesMap(source);
  for (const [gid, val] of Object.entries(norm)) {
    const cur = target[gid];
    if (!cur) {
      target[gid] = val;
    } else if (typeof val === 'object' && val !== null) {
      if (typeof cur !== 'object' || cur === null) {
        target[gid] = val;
      } else {
        target[gid] = {
          b: val.b || cur.b || '',
          n: val.n || cur.n || '',
          t: Math.max(val.t || 0, cur.t || 0)
        };
      }
    }
  }
  return target;
}

async function fetchCloudAccountMeta(username) {
  const [ecRes, ntfyRes, kvRes] = await Promise.allSettled([
    fetch(`${EC_BASE}/${EC_MASTER_BIN}?_=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.text() : null),
    fetch(`${NTFY_BASE}/${getNtfyAccountTopic(username)}/json?poll=1`, { cache: 'no-store' }).then(r => r.ok ? r.text() : null),
    kvGet(`snes_usr_${username}`)
  ]);

  let foundPassHash = null;
  const mergedSaves = {};
  let anyProviderResponded = false;

  if (ecRes.status === 'fulfilled' && ecRes.value) {
    const master = parseEcJson(ecRes.value);
    if (master && typeof master === 'object') {
      anyProviderResponded = true;
      const uObj = master.users && master.users[username];
      if (uObj && uObj.p) {
        foundPassHash = uObj.p;
        mergeSavesMaps(mergedSaves, uObj.s);
      }
    }
  }

  if (ntfyRes.status === 'fulfilled' && ntfyRes.value !== null) {
    anyProviderResponded = true;
    const lines = ntfyRes.value.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev && ev.event === 'message' && ev.message) {
          const parsed = JSON.parse(fromSafeB64Url(ev.message));
          if (parsed && parsed.p) {
            foundPassHash = foundPassHash || parsed.p;
            mergeSavesMaps(mergedSaves, parsed.s);
          }
        }
      } catch (e) {}
    }
  }

  if (kvRes.status === 'fulfilled' && kvRes.value) {
    anyProviderResponded = true;
    try {
      const parsed = JSON.parse(kvRes.value);
      if (parsed && parsed.p) {
        foundPassHash = foundPassHash || parsed.p;
        mergeSavesMaps(mergedSaves, parsed.s);
      }
    } catch (e) {}
  }

  return { found: Boolean(foundPassHash), passHash: foundPassHash, saves: mergedSaves, online: anyProviderResponded };
}

// Local IndexedDB cache for instant fast loads alongside Cloud Sync
function openSaveDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('snes_cloud_saves_db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutState(key, uint8) {
  try {
    const db = await openSaveDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('states', 'readwrite');
      tx.objectStore('states').put(uint8, key);
      tx.oncomplete = res;
      tx.onerror = rej;
    });
  } catch (e) {}
}

async function idbGetState(key) {
  try {
    const db = await openSaveDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction('states', 'readonly');
      const r = tx.objectStore('states').get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = rej;
    });
  } catch (e) {
    return null;
  }
}

async function compressBytes(uint8) {
  if (typeof CompressionStream === 'undefined') return uint8;
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(uint8);
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function decompressBytes(uint8) {
  if (typeof DecompressionStream === 'undefined') return uint8;
  // Check gzip magic header 0x1f 0x8b
  if (uint8.length < 2 || uint8[0] !== 0x1f || uint8[1] !== 0x8b) return uint8;
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(uint8);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

function updateAuthUI() {
  const outEl = document.getElementById('authLoggedOut');
  const inEl = document.getElementById('authLoggedIn');
  const badgeEl = document.getElementById('loggedUserBadge');
  if (cloudAccount) {
    outEl.classList.add('is-hidden');
    inEl.classList.remove('is-hidden');
    const saveCount = Object.keys(cloudAccount.saves || {}).length;
    badgeEl.textContent = `☁️ ${cloudAccount.username} (${saveCount} saves)`;
  } else {
    outEl.classList.remove('is-hidden');
    inEl.classList.add('is-hidden');
  }
  updateCounts();
  applyFilters();
}

async function syncAccountMetaToCloud() {
  if (!cloudAccount) return false;
  localStorage.setItem('snes_cloud_session', JSON.stringify(cloudAccount));
  const userObj = {
    p: cloudAccount.passHash,
    s: cloudAccount.saves || {},
    t: Date.now()
  };
  const payloadStr = JSON.stringify(userObj);

  const writeEcMaster = async () => {
    try {
      let master = { users: {} };
      const getRes = await fetch(`${EC_BASE}/${EC_MASTER_BIN}?_=${Date.now()}`, { cache: 'no-store' });
      if (getRes.ok) {
        const parsed = parseEcJson(await getRes.text());
        if (parsed && typeof parsed === 'object') {
          master = parsed;
          if (!master.users || typeof master.users !== 'object') master.users = {};
        }
      }
      const existingUser = master.users[cloudAccount.username];
      if (existingUser && existingUser.s) {
        mergeSavesMaps(cloudAccount.saves, existingUser.s);
        userObj.s = cloudAccount.saves;
      }
      master.users[cloudAccount.username] = userObj;
      const putRes = await fetch(`${EC_BASE}/${EC_MASTER_BIN}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(master)
      });
      return putRes.ok;
    } catch (e) {
      return false;
    }
  };

  const writeNtfyAcc = async () => {
    try {
      const r = await fetch(`${NTFY_BASE}/${getNtfyAccountTopic(cloudAccount.username)}`, {
        method: 'POST',
        body: toSafeB64Url(payloadStr)
      });
      return r.ok;
    } catch (e) {
      return false;
    }
  };

  const results = await Promise.allSettled([
    writeEcMaster(),
    writeNtfyAcc(),
    kvSet(`snes_usr_${cloudAccount.username}`, payloadStr)
  ]);
  localStorage.setItem('snes_cloud_session', JSON.stringify(cloudAccount));
  return results.some(r => r.status === 'fulfilled' && r.value === true);
}

async function refreshAccountFromCloud() {
  if (!cloudAccount || !cloudAccount.username) return;
  try {
    const meta = await fetchCloudAccountMeta(cloudAccount.username);
    if (meta && meta.found) {
      mergeSavesMaps(cloudAccount.saves, meta.saves);
      localStorage.setItem('snes_cloud_session', JSON.stringify(cloudAccount));
      updateAuthUI();
    }
  } catch (e) {}
}

async function loginOrCreateAccount(rawUser, rawPass) {
  const username = cleanUsername(rawUser);
  const pass = (rawPass || '').trim();
  if (!username || username.length < 2) {
    showToast('⚠️ Digite um nome de usuário válido (mínimo 2 letras/números).', true);
    return false;
  }
  if (!pass || pass.length < 3) {
    showToast('⚠️ Digite uma senha com pelo menos 3 caracteres.', true);
    return false;
  }

  showToast('☁️ Conectando à sua conta na nuvem...');
  try {
    const passHash = await hashPassword(username, pass);
    const meta = await fetchCloudAccountMeta(username);

    if (meta.found) {
      if (meta.passHash !== passHash) {
        showToast('❌ Senha incorreta para este usuário!', true);
        return false;
      }
      cloudAccount = { username, passHash, saves: meta.saves || {} };
      localStorage.setItem('snes_cloud_session', JSON.stringify(cloudAccount));
      updateAuthUI();
      showToast(`☁️ Bem-vindo de volta, ${username}! Seus saves da nuvem estão ativos.`);
    } else {
      cloudAccount = { username, passHash, saves: {} };
      await syncAccountMetaToCloud();
      updateAuthUI();
      showToast(`✅ Conta "${username}" criada na nuvem com sucesso!`);
    }
    return true;
  } catch (e) {
    showToast('⚠️ Erro de conexão ao acessar a nuvem. Tente novamente.', true);
    return false;
  }
}

function logoutAccount() {
  cloudAccount = null;
  localStorage.removeItem('snes_cloud_session');
  if (activeFilter === 'saved') activeFilter = 'all';
  updateAuthUI();
  showToast('👋 Você saiu da sua conta.');
}

async function saveCurrentGameToCloud(passedStateBytes) {
  if (!currentGame) return;

  let rawBytes = (passedStateBytes && typeof passedStateBytes.byteLength === 'number' && passedStateBytes.byteLength > 0) ? passedStateBytes : null;
  if (!rawBytes) {
    try {
      if (emuFrame.contentWindow && typeof emuFrame.contentWindow.captureEmulatorState === 'function') {
        rawBytes = emuFrame.contentWindow.captureEmulatorState();
      }
    } catch (e) {}
  }

  if (!cloudAccount) {
    if (rawBytes && rawBytes.length) {
      pendingSaveBytes = new Uint8Array(rawBytes.length);
      for (let i = 0; i < rawBytes.length; i++) pendingSaveBytes[i] = rawBytes[i];
    }
    pendingCloudAction = 'save';
    document.getElementById('loginModal').classList.add('open');
    document.getElementById('modalUserInp').focus();
    return;
  }

  if (!rawBytes && pendingSaveBytes && pendingSaveBytes.length) {
    rawBytes = pendingSaveBytes;
    pendingSaveBytes = null;
  }

  if (!rawBytes || !rawBytes.length) {
    showToast('⚠️ Aguarde o jogo iniciar na tela antes de salvar!', true);
    return;
  }

  // Copy cross-realm iframe Uint8Array into parent window Uint8Array
  const cleanBytes = new Uint8Array(rawBytes.length);
  for (let i = 0; i < rawBytes.length; i++) cleanBytes[i] = rawBytes[i];

  const saveBtn = document.getElementById('emuSaveBtn');
  const origText = saveBtn.textContent;
  saveBtn.textContent = '⏳ Salvando na Nuvem...';
  saveBtn.disabled = true;

  try {
    const compressed = await compressBytes(cleanBytes);
    const b64Compressed = uint8ToBase64(compressed);
    const existingEntry = (cloudAccount.saves && typeof cloudAccount.saves[currentGame.id] === 'object')
      ? cloudAccount.saves[currentGame.id]
      : null;

    // Upload 1: Permanent Cloud JSON Bin (extendsclass.com)
    const uploadToEcBin = async () => {
      const bodyStr = JSON.stringify({
        s: b64Compressed,
        g: currentGame.id,
        u: cloudAccount.username,
        t: Date.now()
      });
      if (existingEntry && existingEntry.b) {
        try {
          const putRes = await fetch(`${EC_BASE}/${existingEntry.b}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: bodyStr
          });
          if (putRes.ok) return existingEntry.b;
        } catch (e) {}
      }
      const postRes = await fetch(EC_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr
      });
      if (!postRes.ok) return '';
      const info = parseEcJson(await postRes.text());
      return (info && info.id) ? String(info.id) : '';
    };

    // Upload 2: Cloud Binary Attachment (ntfy.sh)
    const uploadToNtfy = async () => {
      const topic = getNtfySaveTopic(cloudAccount.username, currentGame.id, cloudAccount.passHash);
      const upRes = await fetch(`${NTFY_BASE}/${topic}`, {
        method: 'PUT',
        headers: { 'Filename': 'save.gz' },
        body: compressed
      });
      if (!upRes.ok) return '';
      const upJson = await upRes.json();
      return (upJson && upJson.attachment && upJson.attachment.url) ? String(upJson.attachment.url) : '';
    };

    const [ecResult, ntfyResult] = await Promise.allSettled([uploadToEcBin(), uploadToNtfy()]);
    const binId = (ecResult.status === 'fulfilled' && ecResult.value) ? ecResult.value : ((existingEntry && existingEntry.b) || '');
    const ntfyUrl = (ntfyResult.status === 'fulfilled' && ntfyResult.value) ? ntfyResult.value : ((existingEntry && existingEntry.n) || '');

    if (!binId && !ntfyUrl) {
      throw new Error('Cloud upload failed');
    }

    const saveMeta = { b: binId, n: ntfyUrl, t: Date.now() };
    cloudAccount.saves[currentGame.id] = saveMeta;

    await Promise.allSettled([
      syncAccountMetaToCloud(),
      kvSet(`snes_f_${cloudAccount.username}_${currentGame.id}`, JSON.stringify(saveMeta)),
      idbPutState(`${cloudAccount.username}:${currentGame.id}`, cleanBytes)
    ]);

    updateAuthUI();
    try {
      if (emuFrame.contentWindow && typeof emuFrame.contentWindow.showEmulatorMessage === 'function') {
        emuFrame.contentWindow.showEmulatorMessage('SALVO NA NUVEM COM SUCESSO!');
      }
    } catch (e) {}
    showToast(`☁️ Progresso de "${currentGame.title}" salvo na nuvem com sucesso!`);
  } catch (e) {
    showToast('⚠️ Falha de conexão ao salvar na nuvem. Verifique sua internet e tente novamente.', true);
  } finally {
    saveBtn.textContent = origText;
    saveBtn.disabled = false;
    try { emuFrame.focus(); } catch (e) {}
  }
}

async function loadCurrentGameFromCloud() {
  if (!currentGame) return;
  if (!cloudAccount) {
    pendingCloudAction = 'load';
    document.getElementById('loginModal').classList.add('open');
    document.getElementById('modalUserInp').focus();
    return;
  }

  const loadBtn = document.getElementById('emuLoadBtn');
  const origText = loadBtn.textContent;
  loadBtn.textContent = '⏳ Carregando da Nuvem...';
  loadBtn.disabled = true;

  try {
    await refreshAccountFromCloud();

    let entry = (cloudAccount.saves && cloudAccount.saves[currentGame.id]) || null;
    const kvRaw = await kvGet(`snes_f_${cloudAccount.username}_${currentGame.id}`);
    if (kvRaw) {
      try {
        const kvParsed = JSON.parse(kvRaw);
        if (kvParsed && typeof kvParsed === 'object') {
          entry = (typeof entry === 'object' && entry !== null)
            ? { b: kvParsed.b || entry.b || '', n: kvParsed.n || entry.n || '', t: Math.max(kvParsed.t || 0, entry.t || 0) }
            : kvParsed;
        }
      } catch (e) {
        if (kvRaw.startsWith('http')) {
          entry = (typeof entry === 'object' && entry !== null) ? { ...entry, n: entry.n || kvRaw } : { b: '', n: kvRaw, t: 0 };
        }
      }
    }

    let stateBytes = null;

    // 1. Primary Cloud Load: Permanent JSON Bin (extendsclass.com)
    if (entry && typeof entry === 'object' && entry.b) {
      try {
        const r = await fetch(`${EC_BASE}/${entry.b}?_=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) {
          const obj = parseEcJson(await r.text());
          if (obj && obj.s) {
            stateBytes = await decompressBytes(base64ToUint8(obj.s));
          }
        }
      } catch (e) {}
    }

    // 2. Secondary Cloud Load: Direct Ntfy Attachment URL
    if (!stateBytes && entry && typeof entry === 'object' && entry.n) {
      try {
        const r = await fetch(entry.n, { cache: 'no-store' });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          stateBytes = await decompressBytes(new Uint8Array(buf));
        }
      } catch (e) {}
    }

    // 3. Tertiary Cloud Load: Poll deterministic Ntfy topic directly
    if (!stateBytes) {
      try {
        const topic = getNtfySaveTopic(cloudAccount.username, currentGame.id, cloudAccount.passHash);
        const pollRes = await fetch(`${NTFY_BASE}/${topic}/json?poll=1`, { cache: 'no-store' });
        if (pollRes.ok) {
          const text = await pollRes.text();
          const lines = text.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const ev = JSON.parse(lines[i]);
              if (ev && ev.attachment && ev.attachment.url) {
                const attRes = await fetch(ev.attachment.url, { cache: 'no-store' });
                if (attRes.ok) {
                  const buf = await attRes.arrayBuffer();
                  stateBytes = await decompressBytes(new Uint8Array(buf));
                  break;
                }
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 4. Offline cache fallback only if cloud is unreachable
    if (!stateBytes) {
      stateBytes = await idbGetState(`${cloudAccount.username}:${currentGame.id}`);
    } else {
      await idbPutState(`${cloudAccount.username}:${currentGame.id}`, stateBytes);
    }

    if (!stateBytes || !stateBytes.length) {
      showToast('⚠️ Nenhum save encontrado na nuvem para este jogo ainda!', true);
      return;
    }

    let ok = false;
    if (emuFrame.contentWindow && typeof emuFrame.contentWindow.restoreEmulatorState === 'function') {
      ok = emuFrame.contentWindow.restoreEmulatorState(stateBytes);
    }

    if (ok) {
      showToast(`☁️ Progresso de "${currentGame.title}" carregado da nuvem com sucesso!`);
    } else {
      showToast('⚠️ Aguarde o jogo terminar de carregar na tela e clique em Carregar Save novamente.', true);
    }
  } catch (e) {
    showToast('⚠️ Não foi possível carregar o save da nuvem agora.', true);
  } finally {
    loadBtn.textContent = origText;
    loadBtn.disabled = false;
    try { emuFrame.focus(); } catch (e) {}
  }
}

window.saveCurrentGameToCloud = saveCurrentGameToCloud;
window.loadCurrentGameFromCloud = loadCurrentGameFromCloud;

async function init() {
  buildAzBar();
  try {
    const local = localStorage.getItem('snes_web_userdata');
    if (local) userData = Object.assign(userData, JSON.parse(local));
    const savedSession = localStorage.getItem('snes_cloud_session');
    if (savedSession) {
      cloudAccount = JSON.parse(savedSession);
    }
    const res = await fetch('Sistema/games.json');
    allGames = await res.json();
  } catch (e) {
    summaryEl.textContent = 'Erro ao carregar lista de jogos.';
    return;
  }
  buildCategories();
  updateAuthUI();
  if (cloudAccount) {
    refreshAccountFromCloud();
  }
}

function saveUserData() {
  localStorage.setItem('snes_web_userdata', JSON.stringify(userData));
}

function buildAzBar() {
  const bar = document.getElementById('azBar');
  const letters = ['ALL', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];
  bar.innerHTML = letters.map(l =>
    `<button class="az-btn ${l === 'ALL' ? 'active' : ''}" data-letter="${l}">${l === 'ALL' ? 'Todos' : l}</button>`
  ).join('');
  bar.addEventListener('click', e => {
    const btn = e.target.closest('.az-btn');
    if (!btn) return;
    activeLetter = btn.dataset.letter;
    bar.querySelectorAll('.az-btn').forEach(b => b.classList.toggle('active', b === btn));
    scrollEl.scrollTop = 0;
    applyFilters();
  });
}

function buildCategories() {
  const counts = {};
  allGames.forEach(g => { counts[g.category] = (counts[g.category] || 0) + 1; });
  const order = ['Ação & Aventura', 'RPG', 'Luta', 'Corrida', 'Esportes', 'Nave & Tiro', 'Estratégia & Puzzle', 'Clássicos'];
  const icons = {
    'Ação & Aventura': '⚔️', 'RPG': '🛡️', 'Luta': '🥊', 'Corrida': '🏎️',
    'Esportes': '⚽', 'Nave & Tiro': '🚀', 'Estratégia & Puzzle': '🧩', 'Clássicos': '🕹️'
  };

  document.getElementById('categoryList').innerHTML = order.filter(c => counts[c]).map(c => `
    <button class="nav-item" data-filter="cat:${c}">
      <span>${icons[c] || '🎮'} ${c}</span>
      <span class="nav-count">${counts[c]}</span>
    </button>
  `).join('');

  const mCats = document.getElementById('mobileCats');
  mCats.innerHTML = `
    <button class="mcat-btn active" data-filter="all">🎮 Todos (${allGames.length})</button>
    <button class="mcat-btn" data-filter="saved">☁️ Salvos</button>
    <button class="mcat-btn" data-filter="fav">⭐ Favoritos</button>
    <button class="mcat-btn" data-filter="recent">🕒 Recentes</button>
  ` + order.filter(c => counts[c]).map(c => `
    <button class="mcat-btn" data-filter="cat:${c}">${icons[c]} ${c}</button>
  `).join('');

  mCats.addEventListener('click', e => {
    const btn = e.target.closest('.mcat-btn');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    mCats.querySelectorAll('.mcat-btn').forEach(b => b.classList.toggle('active', b === btn));
    scrollEl.scrollTop = 0;
    applyFilters();
  });
}

function updateCounts() {
  document.getElementById('count-all').textContent = allGames.length;
  document.getElementById('count-fav').textContent = userData.favorites.length;
  document.getElementById('count-recent').textContent = userData.recent.length;
  const savedCnt = cloudAccount && cloudAccount.saves ? Object.keys(cloudAccount.saves).length : 0;
  const savedEl = document.getElementById('count-saved');
  if (savedEl) savedEl.textContent = savedCnt;
}

function applyFilters() {
  const favSet = new Set(userData.favorites);
  const savedMap = (cloudAccount && cloudAccount.saves) ? cloudAccount.saves : {};
  const q = searchQuery.trim().toLowerCase();

  if (activeFilter === 'recent') {
    const map = new Map(allGames.map(g => [g.id, g]));
    filteredGames = userData.recent.map(id => map.get(id)).filter(Boolean);
  } else if (activeFilter === 'saved') {
    filteredGames = allGames.filter(g => !!savedMap[g.id]);
  } else {
    filteredGames = allGames.filter(g => {
      if (activeFilter === 'fav' && !favSet.has(g.id)) return false;
      if (activeFilter.startsWith('cat:') && g.category !== activeFilter.slice(4)) return false;
      return true;
    });
  }

  if (activeLetter !== 'ALL') {
    filteredGames = filteredGames.filter(g => g.letter === activeLetter);
  }
  if (q) {
    filteredGames = filteredGames.filter(g =>
      g.title.toLowerCase().includes(q) || g.file.toLowerCase().includes(q)
    );
  }
  renderGrid();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderGrid() {
  summaryEl.textContent = `Exibindo ${filteredGames.length} de ${allGames.length} jogos`;
  const favSet = new Set(userData.favorites);
  const savedMap = (cloudAccount && cloudAccount.saves) ? cloudAccount.saves : {};
  gridEl.innerHTML = filteredGames.map((g, idx) => `
    <div class="game-card" data-idx="${idx}">
      <div class="cover-wrap">
        <img class="cover-bg" src="${ASSET_BASE}${g.cover}" alt="" loading="lazy" decoding="async">
        <img class="cover-img" src="${ASSET_BASE}${g.cover}" alt="${escapeHtml(g.title)}" loading="lazy" decoding="async">
        ${savedMap[g.id] ? '<div class="saved-badge">☁️ Salvo</div>' : ''}
        <button class="fav-btn ${favSet.has(g.id) ? 'is-fav' : ''}" data-fav="${g.id}">★</button>
        <div class="play-badge">▶ Jogar Agora</div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</div>
        <div class="card-meta">
          <span class="tag">${escapeHtml(g.category)}</span>
          <span>${escapeHtml(g.region)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function openGameInBrowser(game) {
  if (!game) return;
  currentGame = game;
  userData.recent = [game.id, ...userData.recent.filter(id => id !== game.id)].slice(0, 30);
  updateCounts();
  saveUserData();

  emuTitle.textContent = `🕹️ ${game.title}`;
  emuModal.classList.add('open');

  if (cloudAccount && cloudAccount.saves && cloudAccount.saves[game.id]) {
    showToast('☁️ Você tem um Save na nuvem! Clique em "📂 Carregar Save" quando o jogo abrir.');
  }

  const romBase = ASSET_BASE || window.location.href;
  const romUrl = new URL('Roms/' + encodeURIComponent(game.file), romBase).href;
  const playerCssUrl = new URL('Sistema/player.css', window.location.href).href;
  const playerJsUrl = new URL('Sistema/player.js', window.location.href).href;
  const extract7zUrl = new URL('Sistema/extract7z.js', window.location.href).href;

  window._pendingEmuConfig = {
    title: game.title,
    romUrl,
    extract7zUrl
  };

  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="${escapeHtml(playerCssUrl)}">
</head>
<body>
<div id="player"></div>
<script src="${escapeHtml(playerJsUrl)}"></script>
<script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`;
  emuFrame.srcdoc = doc;
  setTimeout(() => { try { emuFrame.focus(); } catch (e) {} }, 150);
}

function closeGame() {
  emuModal.classList.remove('open');
  emuFrame.srcdoc = 'about:blank';
  currentGame = null;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

document.getElementById('emuCloseBtn').addEventListener('click', closeGame);
document.getElementById('emuSaveBtn').addEventListener('click', () => saveCurrentGameToCloud());
document.getElementById('emuLoadBtn').addEventListener('click', () => loadCurrentGameFromCloud());

document.getElementById('emuFsBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    emuModal.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
  try { emuFrame.focus(); } catch (e) {}
});

// Topbar Login / Logout Events
document.getElementById('topLoginBtn').addEventListener('click', async () => {
  const u = document.getElementById('topUserInp').value;
  const p = document.getElementById('topPassInp').value;
  const ok = await loginOrCreateAccount(u, p);
  if (ok) {
    document.getElementById('topPassInp').value = '';
  }
});
document.getElementById('topPassInp').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('topLoginBtn').click();
});
document.getElementById('topLogoutBtn').addEventListener('click', logoutAccount);

// In-Game Login Modal Events
document.getElementById('modalCancelBtn').addEventListener('click', () => {
  pendingCloudAction = null;
  document.getElementById('loginModal').classList.remove('open');
  try { emuFrame.focus(); } catch (e) {}
});
document.getElementById('modalConfirmBtn').addEventListener('click', async () => {
  const u = document.getElementById('modalUserInp').value;
  const p = document.getElementById('modalPassInp').value;
  const ok = await loginOrCreateAccount(u, p);
  if (ok) {
    document.getElementById('modalPassInp').value = '';
    document.getElementById('loginModal').classList.remove('open');
    const act = pendingCloudAction;
    pendingCloudAction = null;
    if (act === 'save') await saveCurrentGameToCloud();
    else if (act === 'load') await loadCurrentGameFromCloud();
  }
});
document.getElementById('modalPassInp').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modalConfirmBtn').click();
});

window.addEventListener('keydown', e => {
  if (document.getElementById('loginModal').classList.contains('open')) {
    if (e.key === 'Escape') document.getElementById('modalCancelBtn').click();
    return;
  }
  if (!emuModal.classList.contains('open')) return;
  if (e.key === 'Escape') {
    closeGame();
    return;
  }
  try {
    if (emuFrame.contentWindow && typeof emuFrame.contentWindow._forwardKeyEvent === 'function') {
      emuFrame.contentWindow._forwardKeyEvent(e);
    }
  } catch (err) {}
});

window.addEventListener('keyup', e => {
  if (document.getElementById('loginModal').classList.contains('open')) return;
  if (!emuModal.classList.contains('open')) return;
  try {
    if (emuFrame.contentWindow && typeof emuFrame.contentWindow._forwardKeyEvent === 'function') {
      emuFrame.contentWindow._forwardKeyEvent(e);
    }
  } catch (err) {}
});

gridEl.addEventListener('click', e => {
  const favBtn = e.target.closest('.fav-btn');
  if (favBtn) {
    e.stopPropagation();
    const id = favBtn.dataset.fav;
    const idx = userData.favorites.indexOf(id);
    if (idx >= 0) {
      userData.favorites.splice(idx, 1);
      favBtn.classList.remove('is-fav');
    } else {
      userData.favorites.push(id);
      favBtn.classList.add('is-fav');
    }
    updateCounts();
    saveUserData();
    if (activeFilter === 'fav') applyFilters();
    return;
  }

  const card = e.target.closest('.game-card');
  if (card) {
    const idx = Number(card.dataset.idx);
    openGameInBrowser(filteredGames[idx]);
  }
});

document.getElementById('sidebar').addEventListener('click', e => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  document.querySelectorAll('.sidebar .nav-item').forEach(b => b.classList.toggle('active', b === btn));
  scrollEl.scrollTop = 0;
  applyFilters();
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  searchClear.style.display = searchQuery ? 'block' : 'none';
  scrollEl.scrollTop = 0;
  applyFilters();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.style.display = 'none';
  applyFilters();
});

document.getElementById('randomBtn').addEventListener('click', () => {
  const pool = filteredGames.length > 0 ? filteredGames : allGames;
  if (!pool.length) return;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  openGameInBrowser(chosen);
});

init();
