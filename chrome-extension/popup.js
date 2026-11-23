const LOCAL_SERVER_URL = 'http://localhost:3000';
const CLOUD_SERVER_URL = 'https://ais-pre-eqopg3zyc7utrib2ilmkpk-197474785049.us-west2.run.app';
const EXT_BUILD_DATE = '2026-11-22';

const serverInput = document.getElementById('serverUrl');
const presetLocalBtn = document.getElementById('presetLocalBtn');
const presetCloudBtn = document.getElementById('presetCloudBtn');
const checkServerBtn = document.getElementById('checkServerBtn');
const serverStatusEl = document.getElementById('serverStatus');
const roomInput = document.getElementById('roomCode');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const modeDesktopBtn = document.getElementById('modeDesktopBtn');
const modeTabBtn = document.getElementById('modeTabBtn');
const versionMetaEl = document.getElementById('versionMeta');
const copyDiagBtn = document.getElementById('copyDiagBtn');

const manifestVersion = chrome.runtime.getManifest().version || '1.0.1';
versionMetaEl.textContent = `v${manifestVersion} · ${EXT_BUILD_DATE}`;

let captureMode = 'desktop';

function randomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function normalizeHttpUrl(rawUrl) {
  const clean = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return LOCAL_SERVER_URL;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('ws://')) return 'http://' + clean.slice(5);
  if (clean.startsWith('wss://')) return 'https://' + clean.slice(6);
  return `http://${clean}`;
}

function toWebSocketUrl(rawUrl) {
  const clean = normalizeHttpUrl(rawUrl);
  const wsBase = clean.replace(/^http/i, 'ws');
  return wsBase.endsWith('/ws') ? wsBase : `${wsBase}/ws`;
}

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push(`[${new Date().toISOString()}] ${message}`);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
  copyDiagBtn.textContent = `Diagnóstico (${Math.min(logs.length, 15)})`;
}

async function checkServerReachability(rawUrl) {
  const baseUrl = normalizeHttpUrl(rawUrl);
  if (baseUrl.includes('ais-dev-')) {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      'URL privada (ais-dev) bloqueada por login. Usa Wi-Fi Local (:3000) o publica la app.';
    return false;
  }

  serverStatusEl.className = 'server-status';
  serverStatusEl.textContent = 'Probando conexión con el puente...';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 401 || res.status === 403) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent =
        `La URL exige autenticación (HTTP ${res.status || 302}). Usa Wi-Fi Local o publicación pública.`;
      return false;
    }

    if (res.status === 404) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent =
        'HTTP 404: El servidor aún no está publicado en esta URL. Usa Wi-Fi Local ("npm start").';
      return false;
    }

    if (!res.ok) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent = `El servidor respondió HTTP ${res.status}.`;
      return false;
    }

    const json = await res.json();
    if (json && json.ok) {
      serverStatusEl.className = 'server-status ok';
      serverStatusEl.textContent = `Puente operativo (${json.activeRooms ?? 0} salas activas).`;
      return true;
    }

    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent = 'Respuesta inesperada del servidor puente.';
    return false;
  } catch {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('192.168.')
      ? 'No responde en red local. Ejecuta "npm start" en tu laptop.'
      : 'No se pudo contactar con el servidor puente.';
    return false;
  }
}

function setMode(mode) {
  captureMode = mode === 'tab' ? 'tab' : 'desktop';
  modeDesktopBtn.className = captureMode === 'desktop' ? 'mode-btn active' : 'mode-btn';
  modeTabBtn.className = captureMode === 'tab' ? 'mode-btn active' : 'mode-btn';
  hintEl.textContent =
    captureMode === 'desktop'
      ? 'Elige "Pantalla completa" y marca "Compartir también el audio del sistema" para escuchar todas tus pestañas y notificaciones.'
      : 'Captura únicamente el audio de la pestaña actual aunque cambies de ventana.';
  chrome.storage.local.get(['streaming', 'lastError'], (data) =>
    updateUi(Boolean(data.streaming), data.lastError || '')
  );
}

modeDesktopBtn.addEventListener('click', () => setMode('desktop'));
modeTabBtn.addEventListener('click', () => setMode('tab'));

presetLocalBtn.addEventListener('click', async () => {
  serverInput.value = LOCAL_SERVER_URL;
  await chrome.storage.local.set({ serverUrl: LOCAL_SERVER_URL });
  checkServerReachability(LOCAL_SERVER_URL);
});

presetCloudBtn.addEventListener('click', async () => {
  serverInput.value = CLOUD_SERVER_URL;
  await chrome.storage.local.set({ serverUrl: CLOUD_SERVER_URL });
  checkServerReachability(CLOUD_SERVER_URL);
});

checkServerBtn.addEventListener('click', async () => {
  const clean = normalizeHttpUrl(serverInput.value);
  serverInput.value = clean;
  await chrome.storage.local.set({ serverUrl: clean });
  checkServerReachability(clean);
});

serverInput.addEventListener('change', async () => {
  const clean = normalizeHttpUrl(serverInput.value);
  serverInput.value = clean;
  await chrome.storage.local.set({ serverUrl: clean });
  checkServerReachability(clean);
});

chrome.storage.local.get(
  ['roomCode', 'serverUrl', 'streaming', 'captureMode', 'errorLogs', 'lastError'],
  (data) => {
    const savedUrl =
      data.serverUrl && !String(data.serverUrl).includes('ais-dev-')
        ? data.serverUrl
        : LOCAL_SERVER_URL;
    serverInput.value = savedUrl;
    roomInput.value = data.roomCode || randomCode();
    captureMode = data.captureMode === 'tab' ? 'tab' : 'desktop';
    setMode(captureMode);
    updateUi(Boolean(data.streaming), data.lastError || '');
    if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
      copyDiagBtn.textContent = `Diagnóstico (${data.errorLogs.length})`;
    }
    checkServerReachability(savedUrl);
  }
);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS_CHANGED') {
    updateUi(Boolean(msg.streaming), msg.errorMessage || '');
  }
});

function updateUi(streaming, errorMessage) {
  toggleBtn.textContent = streaming
    ? 'Detener transmisión'
    : captureMode === 'desktop'
      ? 'Transmitir todo el navegador'
      : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'primary stop' : 'primary';

  if (streaming) {
    statusEl.className = 'status';
    statusEl.textContent = `Transmitiendo audio en sala ${roomInput.value}`;
  } else if (errorMessage) {
    statusEl.className = 'status err';
    statusEl.textContent = errorMessage;
  } else {
    statusEl.className = 'status';
    statusEl.textContent = 'Listo para capturar audio';
  }
}

toggleBtn.addEventListener('click', async () => {
  const serverUrl = normalizeHttpUrl(serverInput.value);
  serverInput.value = serverUrl;
  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) {
    statusEl.className = 'status err';
    statusEl.textContent = 'Ingresa un código válido de 6 caracteres.';
    return;
  }

  await chrome.storage.local.set({ roomCode: code, serverUrl, captureMode, lastError: '' });
  const state = await chrome.storage.local.get(['streaming']);

  if (state.streaming) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => updateUi(false, ''));
    return;
  }

  const reachable = await checkServerReachability(serverUrl);
  if (!reachable) {
    const errMsg = serverStatusEl.textContent || 'Servidor puente no disponible.';
    updateUi(false, errMsg);
    await logExtensionError(`Servidor (${serverUrl}): ${errMsg}`);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (captureMode === 'desktop') {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'], tab, (streamId) => {
      if (!streamId) {
        statusEl.className = 'status';
        statusEl.textContent = 'Selección cancelada.';
        return;
      }
      statusEl.className = 'status';
      statusEl.textContent = 'Conectando con el servidor puente...';
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'desktop',
          streamId,
          roomCode: code,
          wsUrl: toWebSocketUrl(serverUrl),
        },
        (res) => {
          if (res && res.ok) {
            statusEl.textContent = 'Conectando WebSocket...';
          } else {
            updateUi(false, 'No se pudo iniciar la captura offscreen.');
          }
        }
      );
    });
  } else {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        const errMsg = chrome.runtime.lastError?.message || 'sin permisos';
        updateUi(false, `Error al capturar pestaña: ${errMsg}`);
        await logExtensionError(`tabCapture: ${errMsg}`);
        return;
      }
      statusEl.className = 'status';
      statusEl.textContent = 'Conectando con el servidor puente...';
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'tab',
          streamId,
          roomCode: code,
          wsUrl: toWebSocketUrl(serverUrl),
        },
        (res) => {
          if (res && res.ok) {
            statusEl.textContent = 'Conectando WebSocket...';
          } else {
            updateUi(false, 'No se pudo iniciar la captura offscreen.');
          }
        }
      );
    });
  }
});

copyDiagBtn.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['roomCode', 'serverUrl', 'streaming', 'captureMode', 'errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    `Versión: v${manifestVersion} (${EXT_BUILD_DATE})`,
    `Modo: ${data.captureMode || 'desktop'}`,
    `Servidor: ${data.serverUrl || LOCAL_SERVER_URL}`,
    `Sala: ${data.roomCode || 'N/A'}`,
    `Transmitiendo: ${data.streaming ? 'sí' : 'no'}`,
    `Navegador: ${navigator.userAgent}`,
    '',
    logs.length > 0 ? `Errores recientes:\n${logs.join('\n')}` : 'Sin errores recientes.',
  ].join('\n');

  await navigator.clipboard.writeText(report);
  copyDiagBtn.textContent = 'Copiado';
  setTimeout(() => {
    copyDiagBtn.textContent = logs.length > 0 ? `Diagnóstico (${logs.length})` : 'Reportar error';
  }, 1800);
});
