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
      'Captura todo el audio del navegador (todas las pestañas y notificaciones) o una pestaña específica y lo transmite por Wi-Fi a tu smartphone Android.',
    permissions: ['desktopCapture', 'tabCapture', 'activeTab', 'offscreen', 'storage'],
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
        width: 330px;
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
        font-family: monospace;
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 10px;
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
    <p>Escucha todas tus pestañas y notificaciones o una pestaña puntual en tus audífonos Bluetooth.</p>

    <div class="modes">
      <button id="modeDesktopBtn" class="mode-btn active" type="button">Todo el navegador</button>
      <button id="modeTabBtn" class="mode-btn" type="button">Solo esta pestaña</button>
    </div>

    <label for="roomCode">Código de sala (6 caracteres)</label>
    <input id="roomCode" maxlength="6" placeholder="WVB492" />
    <button id="toggleBtn" class="primary">Transmitir todo el navegador</button>
    <div id="hint" class="hint">Elige "Pantalla completa" y marca "Compartir también el audio del sistema" para escuchar todas las pestañas.</div>
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

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push('[' + new Date().toISOString() + '] ' + message);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
}

function setMode(mode) {
  captureMode = mode === 'tab' ? 'tab' : 'desktop';
  modeDesktopBtn.className = captureMode === 'desktop' ? 'mode-btn active' : 'mode-btn';
  modeTabBtn.className = captureMode === 'tab' ? 'mode-btn active' : 'mode-btn';
  hintEl.textContent =
    captureMode === 'desktop'
      ? 'Elige "Pantalla completa" y marca "Compartir también el audio del sistema" para escuchar todas las pestañas y notificaciones.'
      : 'Captura únicamente el audio de la pestaña actual aunque cambies de ventana.';
  chrome.storage.local.get(['streaming'], (data) => updateUi(Boolean(data.streaming)));
}

modeDesktopBtn.addEventListener('click', () => setMode('desktop'));
modeTabBtn.addEventListener('click', () => setMode('tab'));

chrome.storage.local.get(['roomCode', 'streaming', 'captureMode', 'errorLogs'], (data) => {
  roomInput.value = data.roomCode || randomCode();
  captureMode = data.captureMode === 'tab' ? 'tab' : 'desktop';
  setMode(captureMode);
  updateUi(Boolean(data.streaming));
  if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
    copyDiagBtn.textContent = 'Diagnóstico (' + data.errorLogs.length + ')';
  }
});

function updateUi(streaming) {
  toggleBtn.textContent = streaming
    ? 'Detener transmisión'
    : captureMode === 'desktop'
      ? 'Transmitir todo el navegador'
      : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'primary stop' : 'primary';
  statusEl.textContent = streaming
    ? 'Transmitiendo audio en sala ' + roomInput.value
    : 'Listo para capturar audio';
}

toggleBtn.addEventListener('click', async () => {
  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) {
    statusEl.textContent = 'Ingresa un código válido de 6 caracteres.';
    return;
  }
  await chrome.storage.local.set({ roomCode: code, captureMode });
  const state = await chrome.storage.local.get(['streaming']);
  if (state.streaming) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => updateUi(false));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (captureMode === 'desktop') {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'], tab, async (streamId) => {
      if (!streamId) {
        statusEl.textContent = 'Selección cancelada.';
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'desktop',
          streamId,
          roomCode: code,
          wsUrl: '${wsOrigin}/ws',
        },
        (res) => {
          updateUi(Boolean(res && res.ok));
        }
      );
    });
  } else {
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
          sourceKind: 'tab',
          streamId,
          roomCode: code,
          wsUrl: '${wsOrigin}/ws',
        },
        (res) => {
          updateUi(Boolean(res && res.ok));
        }
      );
    });
  }
});

copyDiagBtn.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['roomCode', 'streaming', 'captureMode', 'errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    'Versión: v' + manifestVersion + ' (' + EXT_BUILD_DATE + ')',
    'Modo: ' + (data.captureMode || 'desktop'),
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
        chrome.storage.local.set({ streaming: true });
        sendResponse({ ok: true });
      })
      .catch(async (err) => {
        await appendErrorLog('offscreen: ' + (err?.message || String(err)));
        await chrome.storage.local.set({ streaming: false });
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg.type === 'STOP_CAPTURE' || msg.type === 'CAPTURE_ENDED') {
    if (msg.type === 'STOP_CAPTURE') {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    }
    chrome.storage.local.set({ streaming: false });
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

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'OFFSCREEN_STOP') {
    cleanup();
    return;
  }
  if (msg.type === 'START_CAPTURE') {
    cleanup();
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
        reportError('No se recibió pista de audio. Marca "Compartir también el audio del sistema".');
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED' });
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

      socket = new WebSocket(msg.wsUrl);
      socket.onerror = () => reportError('WebSocket error al conectar con ' + msg.wsUrl);
      socket.onopen = () => {
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
      reportError('offscreen capture: ' + (err?.message || String(err)));
      chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED' });
    }
  }
});

function cleanup() {
  activeReceivers = [];
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
      description: 'Manifest V3 con desktopCapture (todo el navegador) y tabCapture',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'popup.html',
      language: 'html',
      description: 'Selector de modo (Todo el navegador o pestaña), sala y reporte de errores',
      content: popupHtml,
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Inicia desktopCapture o tabCapture, registra errores y copia diagnóstico',
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
      description: 'Contenedor offscreen requerido por Chrome MV3 para WebRTC/WS',
      content: offscreenHtml,
    },
    {
      path: 'offscreen.js',
      language: 'javascript',
      description: 'Captura el audio del navegador/sistema y transmite por WebRTC + WebSocket PCM',
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
