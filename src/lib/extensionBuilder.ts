import JSZip from 'jszip';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

export interface ExtensionFile {
  path: string;
  language: 'json' | 'html' | 'javascript';
  description: string;
  content: string;
}

const CLOUD_BRIDGE_FALLBACK = 'https://ais-pre-eqopg3zyc7utrib2ilmkpk-197474785049.us-west2.run.app';
const LOCAL_BRIDGE_DEFAULT = 'http://localhost:3000';

export function resolveSafeDefaultBridgeOrigin(bridgeOrigin: string): string {
  const clean = bridgeOrigin.trim().replace(/\/+$/, '');
  if (!clean || clean.includes('ais-dev-')) {
    return LOCAL_BRIDGE_DEFAULT;
  }
  return clean;
}

export function buildChromeExtensionFiles(bridgeOrigin: string): ExtensionFile[] {
  const defaultOrigin = resolveSafeDefaultBridgeOrigin(bridgeOrigin);
  const cloudOrigin =
    defaultOrigin.startsWith('https://') && !defaultOrigin.includes('localhost')
      ? defaultOrigin
      : CLOUD_BRIDGE_FALLBACK;

  const manifest = {
    manifest_version: 3,
    name: 'WaveBridge — Audio de Chrome a Bluetooth',
    version: EXTENSION_VERSION,
    description:
      'Captura todo el audio del navegador (todas las pestañas y notificaciones) o una pestaña específica y lo transmite por Wi-Fi a tu smartphone Android.',
    permissions: ['desktopCapture', 'tabCapture', 'activeTab', 'offscreen', 'storage'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_popup: 'popup.html',
      default_title: 'WaveBridge Emisor',
    },
    background: {
      service_worker: 'background.js',
    },
  };

  const popupHtml = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>WaveBridge Emisor</title>
    <style>
      body {
        width: 340px;
        margin: 0;
        padding: 16px;
        background: #0b0d10;
        color: #f4f5f7;
        font-family: system-ui, -apple-system, sans-serif;
      }
      h1 {
        font-size: 16px;
        margin: 0 0 4px 0;
      }
      p {
        font-size: 12px;
        color: #9ca3af;
        margin: 0 0 12px 0;
        line-height: 1.4;
      }
      label {
        display: block;
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 5px;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 11px;
        border-radius: 8px;
        border: 1px solid #232933;
        background: #13171d;
        color: #f4f5f7;
        font-size: 12px;
        margin-bottom: 6px;
      }
      input.code {
        font-family: monospace;
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      .presets {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .preset-btn {
        flex: 1;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid #232933;
        background: #13171d;
        color: #9ca3af;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
      }
      .preset-btn:hover {
        border-color: #38bdf8;
        color: #f4f5f7;
      }
      .server-status {
        margin-bottom: 10px;
        font-size: 11px;
        line-height: 1.35;
        color: #9ca3af;
      }
      .server-status.ok {
        color: #10b981;
      }
      .server-status.err {
        color: #f87171;
      }
      .modes {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      .mode-btn {
        padding: 8px 6px;
        border-radius: 8px;
        border: 1px solid #232933;
        background: #13171d;
        color: #9ca3af;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .mode-btn.active {
        border-color: #0ea5e9;
        background: rgba(14, 165, 233, 0.14);
        color: #f4f5f7;
      }
      button.primary {
        width: 100%;
        padding: 10px 14px;
        border: 0;
        border-radius: 8px;
        background: #0ea5e9;
        color: #06121a;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }
      button.primary.stop {
        background: #dc2626;
        color: #fff;
      }
      .hint {
        margin-top: 8px;
        font-size: 11px;
        color: #9ca3af;
        line-height: 1.35;
      }
      .status {
        margin-top: 10px;
        font-size: 12px;
        color: #38bdf8;
        line-height: 1.4;
      }
      .status.err {
        color: #f87171;
      }
      .footer {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px solid #1f2630;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        color: #6b7280;
      }
      .diag-btn {
        background: none;
        border: 0;
        padding: 0;
        color: #9ca3af;
        font-size: 10px;
        cursor: pointer;
        text-decoration: underline;
      }
      .diag-btn:hover {
        color: #f4f5f7;
      }
    </style>
  </head>
  <body>
    <h1>WaveBridge</h1>
    <p>Escucha todas tus pestañas y notificaciones o una pestaña puntual en tus audífonos Bluetooth.</p>

    <div class="modes">
      <button id="modeDesktopBtn" class="mode-btn active" type="button">Todo el navegador</button>
      <button id="modeTabBtn" class="mode-btn" type="button">Solo esta pestaña</button>
    </div>

    <label for="serverUrl">Servidor puente (Wi-Fi Local o Nube pública)</label>
    <input id="serverUrl" type="url" placeholder="http://localhost:3000" />
    <div class="presets">
      <button id="presetLocalBtn" class="preset-btn" type="button">Wi-Fi Local (:3000)</button>
      <button id="presetCloudBtn" class="preset-btn" type="button">Nube (ais-pre)</button>
      <button id="checkServerBtn" class="preset-btn" type="button">Probar</button>
    </div>
    <div id="serverStatus" class="server-status">Verificando servidor puente...</div>

    <label for="roomCode">Código de sala (6 caracteres)</label>
    <input id="roomCode" class="code" maxlength="6" placeholder="WVB492" />

    <button id="toggleBtn" class="primary">Transmitir todo el navegador</button>
    <div id="hint" class="hint">Elige "Pantalla completa" y marca "Compartir también el audio del sistema" para escuchar todas tus pestañas y notificaciones.</div>
    <div id="status" class="status">Listo para capturar audio</div>

    <div class="footer">
      <span id="versionMeta">v${EXTENSION_VERSION} · ${EXTENSION_RELEASE_DATE}</span>
      <button id="copyDiagBtn" class="diag-btn" type="button">Reportar error</button>
    </div>
    <script src="popup.js"></script>
  </body>
</html>`;

  const popupJs = `const DEFAULT_SERVER_URL = '${defaultOrigin}';
const LOCAL_SERVER_URL = '${LOCAL_BRIDGE_DEFAULT}';
const CLOUD_SERVER_URL = '${cloudOrigin}';
const EXT_BUILD_DATE = '${EXTENSION_RELEASE_DATE}';

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

const manifestVersion = chrome.runtime.getManifest().version || '${EXTENSION_VERSION}';
versionMetaEl.textContent = 'v' + manifestVersion + ' · ' + EXT_BUILD_DATE;

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
  const clean = (rawUrl || '').trim().replace(/\\/+$/, '');
  if (!clean) return DEFAULT_SERVER_URL;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('ws://')) return 'http://' + clean.slice(5);
  if (clean.startsWith('wss://')) return 'https://' + clean.slice(6);
  return 'http://' + clean;
}

function toWebSocketUrl(rawUrl) {
  const clean = normalizeHttpUrl(rawUrl);
  const wsBase = clean.replace(/^http/i, 'ws');
  return wsBase.endsWith('/ws') ? wsBase : wsBase + '/ws';
}

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push('[' + new Date().toISOString() + '] ' + message);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
  copyDiagBtn.textContent = 'Diagnóstico (' + Math.min(logs.length, 15) + ')';
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
    const res = await fetch(baseUrl + '/api/health', {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 401 || res.status === 403) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent =
        'La URL exige autenticación (HTTP ' + (res.status || 302) + '). Usa Wi-Fi Local o publicación pública.';
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
      serverStatusEl.textContent = 'El servidor respondió HTTP ' + res.status + '.';
      return false;
    }

    const json = await res.json();
    if (json && json.ok) {
      serverStatusEl.className = 'server-status ok';
      serverStatusEl.textContent = 'Puente operativo (' + (json.activeRooms ?? 0) + ' salas activas).';
      return true;
    }

    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent = 'Respuesta inesperada del servidor puente.';
    return false;
  } catch {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('192.168.')
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
        : DEFAULT_SERVER_URL;
    serverInput.value = savedUrl;
    roomInput.value = data.roomCode || randomCode();
    captureMode = data.captureMode === 'tab' ? 'tab' : 'desktop';
    setMode(captureMode);
    updateUi(Boolean(data.streaming), data.lastError || '');
    if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
      copyDiagBtn.textContent = 'Diagnóstico (' + data.errorLogs.length + ')';
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
    statusEl.textContent = 'Transmitiendo audio en sala ' + roomInput.value;
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
    await logExtensionError('Servidor (' + serverUrl + '): ' + errMsg);
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
        updateUi(false, 'Error al capturar pestaña: ' + errMsg);
        await logExtensionError('tabCapture: ' + errMsg);
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
    'Versión: v' + manifestVersion + ' (' + EXT_BUILD_DATE + ')',
    'Modo: ' + (data.captureMode || 'desktop'),
    'Servidor: ' + (data.serverUrl || DEFAULT_SERVER_URL),
    'Sala: ' + (data.roomCode || 'N/A'),
    'Transmitiendo: ' + (data.streaming ? 'sí' : 'no'),
    'Navegador: ' + navigator.userAgent,
    '',
    logs.length > 0 ? 'Errores recientes:\\n' + logs.join('\\n') : 'Sin errores recientes.',
  ].join('\\n');
  await navigator.clipboard.writeText(report);
  copyDiagBtn.textContent = 'Copiado';
  setTimeout(() => {
    copyDiagBtn.textContent = logs.length > 0 ? 'Diagnóstico (' + logs.length + ')' : 'Reportar error';
  }, 1800);
});`;

  const backgroundJs = `async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC'],
      justification: 'Streaming de audio del navegador por WebRTC/WebSocket hacia el smartphone.',
    });
  }
}

async function appendErrorLog(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push('[' + new Date().toISOString() + '] ' + message);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
}

function notifyPopup(streaming, errorMessage = '') {
  chrome.runtime.sendMessage({
    type: 'STATUS_CHANGED',
    streaming,
    errorMessage,
  }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    ensureOffscreen()
      .then(() => {
        chrome.storage.local.set({ streaming: false, lastError: '' });
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
        sendResponse({ ok: true });
      })
      .catch(async (err) => {
        const errMsg = 'offscreen: ' + (err?.message || String(err));
        await appendErrorLog(errMsg);
        await chrome.storage.local.set({ streaming: false, lastError: errMsg });
        notifyPopup(false, errMsg);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg.type === 'CAPTURE_CONNECTED') {
    chrome.storage.local.set({ streaming: true, lastError: '' });
    notifyPopup(true, '');
    return false;
  }
  if (msg.type === 'STOP_CAPTURE' || msg.type === 'CAPTURE_ENDED') {
    if (msg.type === 'STOP_CAPTURE') {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    }
    const errMsg = msg.errorMessage ? String(msg.errorMessage) : '';
    chrome.storage.local.set({ streaming: false, lastError: errMsg });
    notifyPopup(false, errMsg);
    sendResponse({ ok: true });
  }
  if (msg.type === 'LOG_ERROR' && msg.message) {
    appendErrorLog(String(msg.message));
  }
});`;

  const offscreenHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body><script src="offscreen.js"></script></body>
</html>`;

  const offscreenJs = `let activeStream = null;
let audioCtx = null;
let socket = null;
let seq = 0;
let isShuttingDown = false;
const peers = new Map();
let activeReceivers = [];

function reportError(message) {
  chrome.runtime.sendMessage({ type: 'LOG_ERROR', message });
}

function encodeAudioPacket(samples, packetSeq, timestampMs, sampleRate, channels) {
  const headerBytes = 16;
  const buffer = new ArrayBuffer(headerBytes + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint16(0, 0x5742, true);
  view.setUint32(2, packetSeq >>> 0, true);
  view.setUint32(6, Math.round(timestampMs) >>> 0, true);
  view.setUint32(10, sampleRate >>> 0, true);
  view.setUint8(14, channels & 0xff);
  view.setUint8(15, 0);
  let offset = headerBytes;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

async function diagnoseWebSocketFailure(wsUrl) {
  try {
    const httpUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\\/ws$/, '/api/health');
    const res = await fetch(httpUrl, { redirect: 'manual' });
    if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 401 || res.status === 403) {
      return 'WebSocket rechazado (HTTP ' + (res.status || 302) + '): la URL requiere login. Usa Wi-Fi Local o publicación pública.';
    }
    if (res.status === 404) {
      return 'WebSocket HTTP 404 en ' + wsUrl + ': la app no está publicada o falta el servidor puente.';
    }
    return 'WebSocket falló en ' + wsUrl + ' (salud HTTP ' + res.status + ').';
  } catch {
    return 'No se pudo conectar con ' + wsUrl + '. Verifica que el servidor puente esté activo.';
  }
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'OFFSCREEN_STOP') {
    cleanup();
    return;
  }
  if (msg.type === 'START_CAPTURE') {
    cleanup();
    isShuttingDown = false;
    try {
      if (msg.sourceKind === 'desktop') {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: msg.streamId,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: msg.streamId,
              maxWidth: 16,
              maxHeight: 16,
              maxFrameRate: 1,
            },
          },
        });
        activeStream.getVideoTracks().forEach((vt) => vt.stop());
      } else {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: msg.streamId,
            },
          },
          video: false,
        });
      }

      const audioTracks = activeStream.getAudioTracks();
      if (audioTracks.length === 0) {
        const noAudioMsg = 'No se recibió pista de audio. Marca "Compartir también el audio del sistema".';
        reportError(noAudioMsg);
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED', errorMessage: noAudioMsg });
        return;
      }
      audioTracks[0].onended = () => {
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED' });
      };

      audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      const src = audioCtx.createMediaStreamSource(activeStream);
      if (msg.sourceKind !== 'desktop') {
        src.connect(audioCtx.destination);
      }

      const processor = audioCtx.createScriptProcessor(1024, 2, 2);
      const silentSink = audioCtx.createGain();
      silentSink.gain.value = 0;

      processor.onaudioprocess = (ev) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || activeReceivers.length === 0) return;
        const needsWs = activeReceivers.some((r) => r.transportMode !== 'webrtc');
        if (!needsWs) return;
        const left = ev.inputBuffer.getChannelData(0);
        const right = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : left;
        const interleaved = new Float32Array(left.length * 2);
        for (let i = 0; i < left.length; i++) {
          interleaved[i * 2] = left[i];
          interleaved[i * 2 + 1] = right[i];
        }
        socket.send(
          encodeAudioPacket(interleaved, seq++, performance.now(), audioCtx.sampleRate, 2)
        );
      };

      src.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(audioCtx.destination);

      let wsConnectedOnce = false;
      socket = new WebSocket(msg.wsUrl);
      socket.onerror = async () => {
        if (isShuttingDown) return;
        const detail = await diagnoseWebSocketFailure(msg.wsUrl);
        reportError(detail);
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED', errorMessage: detail });
      };
      socket.onclose = async (ev) => {
        if (isShuttingDown) return;
        const detail = wsConnectedOnce
          ? 'Conexión WebSocket cerrada (código ' + ev.code + ').'
          : await diagnoseWebSocketFailure(msg.wsUrl);
        reportError(detail);
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED', errorMessage: detail });
      };
      socket.onopen = () => {
        wsConnectedOnce = true;
        chrome.runtime.sendMessage({ type: 'CAPTURE_CONNECTED' });
        socket.send(JSON.stringify({
          type: 'join',
          room: msg.roomCode,
          role: 'sender',
          deviceName: msg.sourceKind === 'desktop' ? 'Chrome Todo el Navegador' : 'Extensión Chrome',
        }));
        socket.send(JSON.stringify({
          type: 'stream-state',
          state: {
            active: true,
            source: 'tab',
            sourceLabel: msg.sourceKind === 'desktop' ? 'Todo el navegador / Sistema' : 'Pestaña de Chrome',
            codec: 'opus-256',
            latencyPreset: 'balanced',
            sampleRate: audioCtx.sampleRate,
            channels: 2,
            muted: false,
          },
        }));
      };

      socket.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;
        const data = JSON.parse(event.data);
        if (data.type === 'room-presence' && Array.isArray(data.receivers)) {
          activeReceivers = data.receivers;
        } else if (data.type === 'receiver-joined') {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          peers.set(data.peerId, pc);
          activeStream.getAudioTracks().forEach((track) => pc.addTrack(track, activeStream));
          pc.onicecandidate = (e) => {
            if (e.candidate) {
              socket.send(JSON.stringify({
                type: 'signal',
                targetId: data.peerId,
                payload: { candidate: e.candidate },
              }));
            }
          };
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.send(JSON.stringify({
            type: 'signal',
            targetId: data.peerId,
            payload: { sdp: pc.localDescription },
          }));
        } else if (data.type === 'receiver-left') {
          const pc = peers.get(data.peerId);
          if (pc) {
            pc.close();
            peers.delete(data.peerId);
          }
        } else if (data.type === 'signal' && data.fromId) {
          const pc = peers.get(data.fromId);
          if (!pc) return;
          if (data.payload.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.payload.sdp));
          } else if (data.payload.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.payload.candidate));
          }
        }
      };
    } catch (err) {
      const errMsg = 'offscreen capture: ' + (err?.message || String(err));
      reportError(errMsg);
      cleanup();
      chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED', errorMessage: errMsg });
    }
  }
});

function cleanup() {
  isShuttingDown = true;
  activeReceivers = [];
  peers.forEach((pc) => pc.close());
  peers.clear();
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
}`;

  return [
    {
      path: 'manifest.json',
      language: 'json',
      description: 'Manifest V3 con desktopCapture (todo el navegador) y tabCapture',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'popup.html',
      language: 'html',
      description: 'Selector de modo, servidor puente editable con prueba en vivo y diagnóstico',
      content: popupHtml,
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Valida servidor puente (/api/health), captura desktop/tab y copia diagnóstico',
      content: popupJs,
    },
    {
      path: 'background.js',
      language: 'javascript',
      description: 'Service Worker MV3 con sincronización real de estado WebSocket/offscreen',
      content: backgroundJs,
    },
    {
      path: 'offscreen.html',
      language: 'html',
      description: 'Contenedor offscreen requerido por Chrome MV3 para WebRTC/WS',
      content: offscreenHtml,
    },
    {
      path: 'offscreen.js',
      language: 'javascript',
      description: 'Captura el audio del navegador/sistema y diagnostica errores WebSocket',
      content: offscreenJs,
    },
  ];
}

export async function createExtensionZipBlob(bridgeOrigin: string): Promise<Blob> {
  const zip = new JSZip();
  const files = buildChromeExtensionFiles(bridgeOrigin);
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'blob' });
}
