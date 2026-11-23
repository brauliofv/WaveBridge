import JSZip from 'jszip';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

export interface ExtensionFile {
  path: string;
  language: 'json' | 'html' | 'javascript';
  description: string;
  content: string;
}

export function buildChromeExtensionFiles(bridgeOrigin: string): ExtensionFile[] {
  const normalizedOrigin = bridgeOrigin.replace(/\/+$/, '');
  const wsOrigin = normalizedOrigin.replace(/^http/i, 'ws');

  const manifest = {
    manifest_version: 3,
    name: 'WaveBridge — Audio de Chrome a Bluetooth',
    version: EXTENSION_VERSION,
    description:
      'Captura el audio de cualquier pestaña de Chrome y lo transmite por Wi-Fi con baja latencia a tu smartphone Android con audífonos Bluetooth.',
    permissions: ['tabCapture', 'activeTab', 'offscreen', 'storage'],
    host_permissions: [`${normalizedOrigin}/*`],
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
        width: 320px;
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
        margin: 0 0 14px 0;
        line-height: 1.4;
      }
      label {
        display: block;
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 6px;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid #232933;
        background: #13171d;
        color: #f4f5f7;
        font-family: monospace;
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 12px;
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
      .status {
        margin-top: 12px;
        font-size: 12px;
        color: #9ca3af;
      }
      .link {
        display: block;
        margin-top: 10px;
        font-size: 11px;
        color: #38bdf8;
        text-decoration: none;
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
    <p>Transmite el audio de esta pestaña por Wi-Fi hacia tu smartphone Android.</p>
    <label for="roomCode">Código de sala (6 caracteres)</label>
    <input id="roomCode" maxlength="6" placeholder="WVB492" />
    <button id="toggleBtn" class="primary">Transmitir pestaña activa</button>
    <div id="status" class="status">Listo para capturar audio</div>
    <a class="link" href="${normalizedOrigin}/?mode=receiver" target="_blank" rel="noreferrer">
      Abrir receptor móvil en navegador
    </a>
    <div class="footer">
      <span id="versionMeta">v${EXTENSION_VERSION} · ${EXTENSION_RELEASE_DATE}</span>
      <button id="copyDiagBtn" class="diag-btn" type="button">Reportar error</button>
    </div>
    <script src="popup.js"></script>
  </body>
</html>`;

  const popupJs = `const EXT_BUILD_DATE = '${EXTENSION_RELEASE_DATE}';
const roomInput = document.getElementById('roomCode');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');
const versionMetaEl = document.getElementById('versionMeta');
const copyDiagBtn = document.getElementById('copyDiagBtn');

const manifestVersion = chrome.runtime.getManifest().version || '${EXTENSION_VERSION}';
versionMetaEl.textContent = 'v' + manifestVersion + ' · ' + EXT_BUILD_DATE;

function randomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push('[' + new Date().toISOString() + '] ' + message);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
}

chrome.storage.local.get(['roomCode', 'streaming', 'errorLogs'], (data) => {
  roomInput.value = data.roomCode || randomCode();
  updateUi(Boolean(data.streaming));
  if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
    copyDiagBtn.textContent = 'Diagnóstico (' + data.errorLogs.length + ')';
  }
});

function updateUi(streaming) {
  toggleBtn.textContent = streaming ? 'Detener transmisión' : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'primary stop' : 'primary';
  statusEl.textContent = streaming
    ? 'Transmitiendo audio en sala ' + roomInput.value
    : 'Listo para capturar la pestaña actual';
}

toggleBtn.addEventListener('click', async () => {
  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) {
    statusEl.textContent = 'Ingresa un código válido de 6 caracteres.';
    return;
  }
  await chrome.storage.local.set({ roomCode: code });
  const state = await chrome.storage.local.get(['streaming']);
  if (state.streaming) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => updateUi(false));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
    if (chrome.runtime.lastError || !streamId) {
      const errMsg = chrome.runtime.lastError?.message || 'sin permisos';
      statusEl.textContent = 'Error al capturar pestaña: ' + errMsg;
      await logExtensionError('tabCapture: ' + errMsg);
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: 'START_CAPTURE',
        streamId,
        roomCode: code,
        wsUrl: '${wsOrigin}/ws',
      },
      (res) => {
        updateUi(Boolean(res && res.ok));
      }
    );
  });
});

copyDiagBtn.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['roomCode', 'streaming', 'errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    'Versión: v' + manifestVersion + ' (' + EXT_BUILD_DATE + ')',
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
      reasons: ['USER_MEDIA', 'WEB_RTC'],
      justification: 'Streaming de audio en tiempo real por WebRTC hacia el smartphone.',
    });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
        chrome.storage.local.set({ streaming: true });
        sendResponse({ ok: true });
      })
      .catch(async (err) => {
        const data = await chrome.storage.local.get(['errorLogs']);
        const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
        logs.push('[' + new Date().toISOString() + '] offscreen: ' + (err?.message || String(err)));
        await chrome.storage.local.set({ errorLogs: logs.slice(-15), streaming: false });
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg.type === 'STOP_CAPTURE') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    chrome.storage.local.set({ streaming: false });
    sendResponse({ ok: true });
  }
  if (msg.type === 'LOG_ERROR' && msg.message) {
    chrome.storage.local.get(['errorLogs'], (data) => {
      const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
      logs.push('[' + new Date().toISOString() + '] ' + msg.message);
      chrome.storage.local.set({ errorLogs: logs.slice(-15) });
    });
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
const peers = new Map();

function reportError(message) {
  chrome.runtime.sendMessage({ type: 'LOG_ERROR', message });
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'OFFSCREEN_STOP') {
    cleanup();
    return;
  }
  if (msg.type === 'START_CAPTURE') {
    cleanup();
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: msg.streamId,
          },
        },
        video: false,
      });

      audioCtx = new AudioContext({ latencyHint: 'interactive' });
      const src = audioCtx.createMediaStreamSource(activeStream);
      src.connect(audioCtx.destination);

      socket = new WebSocket(msg.wsUrl);
      socket.onerror = () => reportError('WebSocket error al conectar con ' + msg.wsUrl);
      socket.onopen = () => {
        socket.send(JSON.stringify({
          type: 'join',
          room: msg.roomCode,
          role: 'sender',
          deviceName: 'Extensión Chrome',
        }));
      };

      socket.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;
        const data = JSON.parse(event.data);
        if (data.type === 'receiver-joined') {
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
      reportError('offscreen capture: ' + (err?.message || String(err)));
    }
  }
});

function cleanup() {
  peers.forEach((pc) => pc.close());
  peers.clear();
  if (socket) {
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
      description: 'Configuración Manifest V3 con permisos tabCapture y offscreen',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'popup.html',
      language: 'html',
      description: 'Interfaz emergente con código de sala, versión y reporte de errores',
      content: popupHtml,
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Captura el streamId, registra errores y copia diagnóstico',
      content: popupJs,
    },
    {
      path: 'background.js',
      language: 'javascript',
      description: 'Service Worker MV3 que gestiona el documento offscreen persistente',
      content: backgroundJs,
    },
    {
      path: 'offscreen.html',
      language: 'html',
      description: 'Contenedor offscreen requerido por Chrome MV3 para WebRTC',
      content: offscreenHtml,
    },
    {
      path: 'offscreen.js',
      language: 'javascript',
      description: 'Captura el audio de la pestaña y reporta errores al diagnóstico',
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
