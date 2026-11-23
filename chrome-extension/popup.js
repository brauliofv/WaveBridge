const LOCAL_SERVER_URL = 'http://localhost:3000';
const EXT_BUILD_DATE = '2026-11-22';

const serverInput = document.getElementById('serverUrl');
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

function isLocalHttpAddress(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname;
    return (
      u.protocol === 'http:' &&
      (h === 'localhost' ||
        h === '127.0.0.1' ||
        h.startsWith('192.168.') ||
        h.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(h))
    );
  } catch {
    return false;
  }
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
  if (!isLocalHttpAddress(baseUrl)) {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      'Usa una dirección local de tu red Wi-Fi (ej. http://localhost:3000 o http://192.168.x.x:3000).';
    return false;
  }

  serverStatusEl.className = 'server-status';
  serverStatusEl.textContent = 'Probando puente local...';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent = `El puente respondió HTTP ${res.status}. Verifica que sea WaveBridge en puerto 3000.`;
      return false;
    }

    const json = await res.json();
    if (json && json.ok) {
      let lanTip = '';
      try {
        const netRes = await fetch(`${baseUrl}/api/network-info`);
        if (netRes.ok) {
          const netJson = await netRes.json();
          if (Array.isArray(netJson.lanUrls) && netJson.lanUrls.length > 0) {
            lanTip = ` · IP Wi-Fi para Android: ${netJson.lanUrls[0]}`;
          }
        }
      } catch {
        // ignore optional LAN info error
      }
      serverStatusEl.className = 'server-status ok';
      serverStatusEl.textContent = `Puente local activo${lanTip}`;
      return true;
    }

    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent = 'Respuesta inesperada del servidor local.';
    return false;
  } catch {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      'Puente local apagado. Ejecuta "python3 bridge.py" en la carpeta del proyecto en tu laptop.';
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
      data.serverUrl && isLocalHttpAddress(data.serverUrl)
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
    statusEl.textContent = `Transmitiendo en Wi-Fi local · Sala ${roomInput.value}`;
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
    const errMsg = serverStatusEl.textContent || 'Puente local no disponible.';
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
      statusEl.textContent = 'Conectando con el puente local...';
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
            statusEl.textContent = 'Conectando WebSocket local...';
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
      statusEl.textContent = 'Conectando con el puente local...';
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
            statusEl.textContent = 'Conectando WebSocket local...';
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
