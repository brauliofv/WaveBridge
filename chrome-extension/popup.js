const DEFAULT_SERVER_URL = 'https://ais-pre-eqopg3zyc7utrib2ilmkpk-197474785049.us-west2.run.app';
const EXT_BUILD_DATE = '2026-11-22';

const serverInput = document.getElementById('serverUrl');
const roomInput = document.getElementById('roomCode');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');
const versionMetaEl = document.getElementById('versionMeta');
const copyDiagBtn = document.getElementById('copyDiagBtn');

const manifestVersion = chrome.runtime.getManifest().version || '1.0.0';
versionMetaEl.textContent = `v${manifestVersion} · ${EXT_BUILD_DATE}`;

function randomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function toWebSocketUrl(rawUrl) {
  const clean = rawUrl.trim().replace(/\/+$/, '');
  const wsBase = clean.startsWith('ws://') || clean.startsWith('wss://')
    ? clean
    : clean.replace(/^http/i, 'ws');
  return wsBase.endsWith('/ws') ? wsBase : `${wsBase}/ws`;
}

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push(`[${new Date().toISOString()}] ${message}`);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
}

chrome.storage.local.get(['roomCode', 'serverUrl', 'streaming', 'errorLogs'], (data) => {
  serverInput.value = data.serverUrl || DEFAULT_SERVER_URL;
  roomInput.value = data.roomCode || randomCode();
  updateUi(Boolean(data.streaming));
  if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
    copyDiagBtn.textContent = `Diagnóstico (${data.errorLogs.length})`;
  }
});

function updateUi(streaming) {
  toggleBtn.textContent = streaming ? 'Detener transmisión' : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'primary stop' : 'primary';
  statusEl.textContent = streaming
    ? `Transmitiendo audio en sala ${roomInput.value}`
    : 'Listo para capturar la pestaña actual';
}

toggleBtn.addEventListener('click', async () => {
  const serverUrl = serverInput.value.trim() || DEFAULT_SERVER_URL;
  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) {
    statusEl.textContent = 'Ingresa un código válido de 6 caracteres.';
    return;
  }

  await chrome.storage.local.set({ roomCode: code, serverUrl });
  const state = await chrome.storage.local.get(['streaming']);

  if (state.streaming) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => updateUi(false));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
    if (chrome.runtime.lastError || !streamId) {
      const errMsg = chrome.runtime.lastError?.message || 'sin permisos';
      statusEl.textContent = `Error al capturar pestaña: ${errMsg}`;
      await logExtensionError(`tabCapture: ${errMsg}`);
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: 'START_CAPTURE',
        streamId,
        roomCode: code,
        wsUrl: toWebSocketUrl(serverUrl),
      },
      (res) => {
        updateUi(Boolean(res && res.ok));
      }
    );
  });
});

copyDiagBtn.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['roomCode', 'serverUrl', 'streaming', 'errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    `Versión: v${manifestVersion} (${EXT_BUILD_DATE})`,
    `Servidor: ${data.serverUrl || DEFAULT_SERVER_URL}`,
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
