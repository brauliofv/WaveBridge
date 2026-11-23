import JSZip from 'jszip';

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
    version: '1.0.0',
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
      button {
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
      button.stop {
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
    </style>
  </head>
  <body>
    <h1>WaveBridge</h1>
    <p>Transmite el audio de esta pestaña por Wi-Fi hacia tu smartphone Android.</p>
    <label for="roomCode">Código de sala (6 caracteres)</label>
    <input id="roomCode" maxlength="6" placeholder="WVB492" />
    <button id="toggleBtn">Transmitir pestaña activa</button>
    <div id="status" class="status">Listo para capturar audio</div>
    <a class="link" href="${normalizedOrigin}/?mode=receiver" target="_blank" rel="noreferrer">
      Abrir receptor móvil en navegador
    </a>
    <script src="popup.js"></script>
  </body>
</html>`;

  const popupJs = `const roomInput = document.getElementById('roomCode');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');

function randomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

chrome.storage.local.get(['roomCode', 'streaming'], (data) => {
  roomInput.value = data.roomCode || randomCode();
  updateUi(Boolean(data.streaming));
});

function updateUi(streaming) {
  toggleBtn.textContent = streaming ? 'Detener transmisión' : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'stop' : '';
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
  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    if (chrome.runtime.lastError || !streamId) {
      statusEl.textContent = 'Error al capturar pestaña: ' + (chrome.runtime.lastError?.message || 'sin permisos');
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
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
      chrome.storage.local.set({ streaming: true });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'STOP_CAPTURE') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    chrome.storage.local.set({ streaming: false });
    sendResponse({ ok: true });
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

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'OFFSCREEN_STOP') {
    cleanup();
    return;
  }
  if (msg.type === 'START_CAPTURE') {
    cleanup();
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: msg.streamId,
        },
      },
      video: false,
    });

    // Keep local tab playback audible on laptop if desired, or mute locally:
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    const src = audioCtx.createMediaStreamSource(activeStream);
    src.connect(audioCtx.destination);

    socket = new WebSocket(msg.wsUrl);
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
      description: 'Interfaz emergente de la extensión para vincular código de sala',
      content: popupHtml,
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Captura el streamId de la pestaña activa y controla el servicio',
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
      description: 'Captura el audio de la pestaña y lo transmite por WebRTC al smartphone',
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
