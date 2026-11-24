import JSZip from 'jszip';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

export interface ExtensionFile {
  path: string;
  language: 'json' | 'html' | 'javascript';
  description: string;
  content: string;
}

const LOCAL_BRIDGE_DEFAULT = 'http://localhost:3000';

export function resolveSafeDefaultBridgeOrigin(bridgeOrigin: string): string {
  const clean = bridgeOrigin.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(clean);
    const h = parsed.hostname;
    const isLocal =
      parsed.protocol === 'http:' &&
      (h === 'localhost' ||
        h === '127.0.0.1' ||
        h.startsWith('192.168.') ||
        h.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(h));
    if (isLocal) return clean;
  } catch {
    // fallback below
  }
  return LOCAL_BRIDGE_DEFAULT;
}

export function buildChromeExtensionFiles(bridgeOrigin: string): ExtensionFile[] {
  const defaultOrigin = resolveSafeDefaultBridgeOrigin(bridgeOrigin);

  const manifest = {
    manifest_version: 3,
    name: 'WaveBridge — Audio de Chrome a Bluetooth',
    version: EXTENSION_VERSION,
    description:
      'Transmite todo el audio del navegador (todas las pestañas y notificaciones) directamente por Wi-Fi local a tu smartphone Android sin usar terminal.',
    permissions: ['desktopCapture', 'tabCapture', 'activeTab', 'offscreen', 'storage'],
    host_permissions: ['http://*/*'],
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
        width: 348px;
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
      .server-row {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }
      .server-row input {
        flex: 1;
        margin-bottom: 0;
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
        margin-bottom: 10px;
      }
      input.code {
        font-family: monospace;
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .check-btn {
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid #232933;
        background: #13171d;
        color: #38bdf8;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .check-btn:hover {
        border-color: #38bdf8;
      }
      .check-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .server-status {
        margin-bottom: 10px;
        font-size: 11px;
        line-height: 1.4;
        color: #9ca3af;
      }
      .server-status.ok {
        color: #10b981;
      }
      .server-status.err {
        color: #f87171;
      }
      .lan-box {
        display: none;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #1f2630;
        background: #13171d;
        font-size: 11px;
      }
      .lan-box.visible {
        display: flex;
      }
      .lan-box code {
        color: #38bdf8;
        font-family: monospace;
        font-size: 11px;
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
    <h1>WaveBridge (Wi-Fi Local)</h1>
    <p>Envía el audio del navegador directo a tu smartphone por Wi-Fi, sin terminal ni nube.</p>

    <label>Conexión Wi-Fi</label>
    <div class="modes">
      <button id="targetDirectBtn" class="mode-btn active" type="button">Directo al móvil</button>
      <button id="targetBridgeBtn" class="mode-btn" type="button">Puente PC (Plan B)</button>
    </div>

    <label id="targetInputLabel" for="serverUrl">IP de tu móvil Android en Wi-Fi (puerto 8765)</label>
    <div class="server-row">
      <input id="serverUrl" type="text" placeholder="Ej. 192.168.100.194" />
      <button id="checkServerBtn" class="check-btn" type="button">Buscar móvil</button>
    </div>
    <div id="serverStatus" class="server-status">Abre la app en Android y pulsa Buscar móvil.</div>
    <div id="lanBox" class="lan-box">
      <span>En Android usa: <code id="lanIpText">—</code></span>
      <button id="copyLanBtn" class="check-btn" type="button">Copiar IP</button>
    </div>

    <label>Captura de audio</label>
    <div class="modes">
      <button id="modeDesktopBtn" class="mode-btn active" type="button">Todo el navegador</button>
      <button id="modeTabBtn" class="mode-btn" type="button">Solo esta pestaña</button>
    </div>

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
const ANDROID_DIRECT_PORT = 8765;
const EXT_BUILD_DATE = '${EXTENSION_RELEASE_DATE}';

const targetDirectBtn = document.getElementById('targetDirectBtn');
const targetBridgeBtn = document.getElementById('targetBridgeBtn');
const targetInputLabel = document.getElementById('targetInputLabel');
const serverInput = document.getElementById('serverUrl');
const checkServerBtn = document.getElementById('checkServerBtn');
const serverStatusEl = document.getElementById('serverStatus');
const lanBoxEl = document.getElementById('lanBox');
const lanIpTextEl = document.getElementById('lanIpText');
const copyLanBtn = document.getElementById('copyLanBtn');
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
let targetMode = 'direct';

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
        /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(h))
    );
  } catch {
    return false;
  }
}

function normalizeTargetUrl(rawValue, mode = targetMode) {
  const clean = (rawValue || '').trim().replace(/\\/+$/, '');
  if (!clean) {
    return mode === 'bridge' ? DEFAULT_SERVER_URL : '';
  }
  let withProto = clean;
  if (withProto.startsWith('ws://')) {
    withProto = 'http://' + withProto.slice(5);
  } else if (withProto.startsWith('wss://')) {
    withProto = 'https://' + withProto.slice(6);
  } else if (!withProto.startsWith('http://') && !withProto.startsWith('https://')) {
    withProto = 'http://' + withProto;
  }
  try {
    const parsed = new URL(withProto);
    if (mode === 'direct' && !parsed.port) {
      parsed.port = String(ANDROID_DIRECT_PORT);
    } else if (mode === 'bridge' && !parsed.port) {
      parsed.port = '3000';
    }
    return parsed.origin;
  } catch {
    return withProto;
  }
}

function toWebSocketUrl(rawUrl, mode = targetMode) {
  const clean = normalizeTargetUrl(rawUrl, mode);
  if (!clean) return '';
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

async function probeDirectAndroidHealth(baseUrl, timeoutMs = 450) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl + '/api/health', {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.ok && json.service === 'wavebridge-android') {
      return { baseUrl, json };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function detectWebRtcLocalPrefix() {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      let resolved = false;
      const done = (val) => {
        if (resolved) return;
        resolved = true;
        try {
          pc.close();
        } catch {
          // ignore
        }
        resolve(val);
      };
      pc.createDataChannel('probe');
      pc.onicecandidate = (ev) => {
        const cand = ev?.candidate?.candidate || '';
        const match = cand.match(/\\b((?:192\\.168|10\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[0-1]))\\.\\d{1,3})\\.\\d{1,3}\\b/);
        if (match && match[1]) {
          done(match[1]);
        } else if (!ev.candidate) {
          done(null);
        }
      };
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => done(null));
      setTimeout(() => done(null), 400);
    } catch {
      resolve(null);
    }
  });
}

async function scanWifiForAndroid() {
  checkServerBtn.disabled = true;
  checkServerBtn.textContent = 'Buscando...';
  serverStatusEl.className = 'server-status';
  serverStatusEl.textContent = 'Escaneando Wi-Fi local (puerto 8765)...';

  try {
    const currentNormalized = normalizeTargetUrl(serverInput.value, 'direct');
    if (currentNormalized && isLocalHttpAddress(currentNormalized)) {
      const quickHit = await probeDirectAndroidHealth(currentNormalized, 900);
      if (quickHit) {
        applyFoundPhone(quickHit);
        return true;
      }
    }

    const detectedPrefix = await detectWebRtcLocalPrefix();
    const prefixes = [];
    if (detectedPrefix) prefixes.push(detectedPrefix);
    ['192.168.1', '192.168.0', '192.168.100', '192.168.43', '10.0.0'].forEach((p) => {
      if (!prefixes.includes(p)) prefixes.push(p);
    });

    for (const prefix of prefixes) {
      serverStatusEl.textContent = 'Buscando Android en ' + prefix + '.x:8765...';
      const hosts = [];
      for (let i = 2; i <= 254; i++) {
        hosts.push(prefix + '.' + i);
      }
      for (let i = 0; i < hosts.length; i += 32) {
        const batch = hosts.slice(i, i + 32);
        const results = await Promise.all(
          batch.map((ip) => probeDirectAndroidHealth('http://' + ip + ':' + ANDROID_DIRECT_PORT, 380))
        );
        const found = results.find((item) => item !== null);
        if (found) {
          applyFoundPhone(found);
          return true;
        }
      }
    }

    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      'No se detectó tu móvil en este Wi-Fi. Verifica que la app WaveBridge esté abierta, o escribe su IP manualmente. Si tu router bloquea la conexión directa, usa "Puente PC (Plan B)".';
    return false;
  } finally {
    checkServerBtn.disabled = false;
    checkServerBtn.textContent = targetMode === 'direct' ? 'Buscar móvil' : 'Probar';
  }
}

function applyFoundPhone(hit) {
  const { baseUrl, json } = hit;
  serverInput.value = baseUrl;
  const detectedRoom =
    typeof json.roomCode === 'string' && /^[A-Z0-9]{6}$/.test(json.roomCode.toUpperCase())
      ? json.roomCode.toUpperCase()
      : '';
  if (detectedRoom) {
    roomInput.value = detectedRoom;
    chrome.storage.local.set({ directUrl: baseUrl, roomCode: detectedRoom });
  } else {
    chrome.storage.local.set({ directUrl: baseUrl });
  }
  const devName = json.deviceName ? json.deviceName + ' · ' : '';
  const roomSuffix = detectedRoom ? ' · Sala ' + detectedRoom : '';
  serverStatusEl.className = 'server-status ok';
  serverStatusEl.textContent = 'Móvil listo: ' + devName + baseUrl + roomSuffix;
}

async function checkServerReachability(rawUrl, mode = targetMode) {
  const baseUrl = normalizeTargetUrl(rawUrl, mode);
  if (!baseUrl || !isLocalHttpAddress(baseUrl)) {
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      mode === 'direct'
        ? 'Escribe la IP de tu móvil (ej. 192.168.1.42) o pulsa Buscar móvil.'
        : 'Usa una dirección local de tu red Wi-Fi (ej. http://localhost:3000).';
    return false;
  }

  serverStatusEl.className = 'server-status';
  serverStatusEl.textContent =
    mode === 'direct' ? 'Verificando móvil en ' + baseUrl + '...' : 'Probando puente local...';
  if (mode === 'direct') {
    lanBoxEl.className = 'lan-box';
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(baseUrl + '/api/health', {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent = 'Respondió HTTP ' + res.status + ' en ' + baseUrl + '.';
      return false;
    }

    const json = await res.json();
    if (mode === 'direct') {
      if (json && json.ok && json.service === 'wavebridge-android') {
        applyFoundPhone({ baseUrl, json });
        return true;
      }
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent = 'Ese dispositivo no es el receptor WaveBridge Android.';
      return false;
    }

    if (json && json.ok) {
      let primaryLanUrl = '';
      try {
        const netRes = await fetch(baseUrl + '/api/network-info');
        if (netRes.ok) {
          const netJson = await netRes.json();
          if (Array.isArray(netJson.lanUrls) && netJson.lanUrls.length > 0) {
            primaryLanUrl = netJson.lanUrls[0];
          }
        }
      } catch {
        // ignore optional LAN info error
      }
      serverStatusEl.className = 'server-status ok';
      serverStatusEl.textContent = primaryLanUrl
        ? 'Puente PC activo (' + (json.runtime || 'node') + ')'
        : 'Puente PC activo';
      if (primaryLanUrl) {
        lanIpTextEl.textContent = primaryLanUrl;
        lanBoxEl.className = 'lan-box visible';
      } else {
        lanBoxEl.className = 'lan-box';
      }
      return true;
    }

    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent = 'Respuesta inesperada del puente local.';
    return false;
  } catch (err) {
    const errDetail = err && (err.name || err.message) ? ' [' + (err.name || 'Error') + ': ' + (err.message || '') + ']' : '';
    lanBoxEl.className = 'lan-box';
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      mode === 'direct'
        ? 'No responde ' + baseUrl + errDetail + '. Abre WaveBridge en Android y pulsa Buscar móvil (o usa Puente PC Plan B).'
        : 'Puente local apagado' + errDetail + '. Ejecuta "python3 bridge.py" (Plan B) o "npm run web" (Plan C).';
    return false;
  }
}

copyLanBtn.addEventListener('click', async () => {
  const val = lanIpTextEl.textContent || '';
  if (!val || val === '—') return;
  await navigator.clipboard.writeText(val);
  copyLanBtn.textContent = 'Copiado';
  setTimeout(() => {
    copyLanBtn.textContent = 'Copiar IP';
  }, 1500);
});

function setTargetMode(mode, storedData) {
  targetMode = mode === 'bridge' ? 'bridge' : 'direct';
  targetDirectBtn.className = targetMode === 'direct' ? 'mode-btn active' : 'mode-btn';
  targetBridgeBtn.className = targetMode === 'bridge' ? 'mode-btn active' : 'mode-btn';

  if (targetMode === 'direct') {
    lanBoxEl.className = 'lan-box';
    targetInputLabel.textContent = 'IP de tu móvil Android en Wi-Fi (puerto 8765)';
    serverInput.placeholder = 'Ej. 192.168.100.194';
    checkServerBtn.textContent = 'Buscar móvil';
    if (storedData !== undefined) {
      serverInput.value =
        storedData.directUrl && isLocalHttpAddress(storedData.directUrl)
          ? storedData.directUrl
          : '';
    }
    if (serverInput.value) {
      checkServerReachability(serverInput.value, 'direct');
    } else {
      serverStatusEl.className = 'server-status';
      serverStatusEl.textContent = 'Abre WaveBridge en tu Android y pulsa "Buscar móvil".';
    }
  } else {
    targetInputLabel.textContent = 'Puente PC Plan B / C en esta laptop (puerto 3000)';
    serverInput.placeholder = 'http://localhost:3000';
    checkServerBtn.textContent = 'Probar';
    if (storedData !== undefined) {
      serverInput.value =
        storedData.bridgeUrl && isLocalHttpAddress(storedData.bridgeUrl)
          ? storedData.bridgeUrl
          : DEFAULT_SERVER_URL;
    }
    checkServerReachability(serverInput.value || DEFAULT_SERVER_URL, 'bridge');
  }
}

function setCaptureMode(mode) {
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

targetDirectBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ targetMode: 'direct' });
  const data = await chrome.storage.local.get(['directUrl']);
  setTargetMode('direct', data);
});

targetBridgeBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ targetMode: 'bridge' });
  const data = await chrome.storage.local.get(['bridgeUrl']);
  setTargetMode('bridge', { bridgeUrl: data.bridgeUrl || DEFAULT_SERVER_URL });
});

modeDesktopBtn.addEventListener('click', () => setCaptureMode('desktop'));
modeTabBtn.addEventListener('click', () => setCaptureMode('tab'));

checkServerBtn.addEventListener('click', async () => {
  if (targetMode === 'direct') {
    await scanWifiForAndroid();
  } else {
    const clean = normalizeTargetUrl(serverInput.value, 'bridge');
    serverInput.value = clean;
    await chrome.storage.local.set({ bridgeUrl: clean });
    checkServerReachability(clean, 'bridge');
  }
});

serverInput.addEventListener('change', async () => {
  const clean = normalizeTargetUrl(serverInput.value, targetMode);
  serverInput.value = clean;
  if (targetMode === 'direct') {
    await chrome.storage.local.set({ directUrl: clean });
  } else {
    await chrome.storage.local.set({ bridgeUrl: clean });
  }
  if (clean) {
    checkServerReachability(clean, targetMode);
  }
});

chrome.storage.local.get(
  ['roomCode', 'targetMode', 'directUrl', 'bridgeUrl', 'streaming', 'captureMode', 'errorLogs', 'lastError'],
  (data) => {
    roomInput.value = data.roomCode || randomCode();
    captureMode = data.captureMode === 'tab' ? 'tab' : 'desktop';
    setTargetMode(data.targetMode === 'bridge' ? 'bridge' : 'direct', data);
    setCaptureMode(captureMode);
    updateUi(Boolean(data.streaming), data.lastError || '');
    if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
      copyDiagBtn.textContent = 'Diagnóstico (' + data.errorLogs.length + ')';
    }
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
    statusEl.textContent = 'Transmitiendo en Wi-Fi local · Sala ' + roomInput.value;
  } else if (errorMessage) {
    statusEl.className = 'status err';
    statusEl.textContent = errorMessage;
  } else {
    statusEl.className = 'status';
    statusEl.textContent = 'Listo para capturar audio';
  }
}

toggleBtn.addEventListener('click', async () => {
  const state = await chrome.storage.local.get(['streaming']);
  if (state.streaming) {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => updateUi(false, ''));
    return;
  }

  let serverUrl = normalizeTargetUrl(serverInput.value, targetMode);
  if (targetMode === 'direct' && !serverUrl) {
    const found = await scanWifiForAndroid();
    serverUrl = normalizeTargetUrl(serverInput.value, 'direct');
    if (!found || !serverUrl) {
      const errMsg = serverStatusEl.textContent || 'No se encontró tu smartphone Android en Wi-Fi.';
      updateUi(false, errMsg);
      await logExtensionError('Directo Wi-Fi: ' + errMsg);
      return;
    }
  } else {
    serverInput.value = serverUrl;
  }

  const code = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) {
    statusEl.className = 'status err';
    statusEl.textContent = 'Ingresa un código válido de 6 caracteres.';
    return;
  }

  const savePayload = {
    roomCode: code,
    targetMode,
    captureMode,
    lastError: '',
  };
  if (targetMode === 'direct') {
    savePayload.directUrl = serverUrl;
  } else {
    savePayload.bridgeUrl = serverUrl;
  }
  await chrome.storage.local.set(savePayload);

  const reachable = await checkServerReachability(serverUrl, targetMode);
  if (!reachable) {
    const errMsg = serverStatusEl.textContent || 'Destino local no disponible.';
    updateUi(false, errMsg);
    await logExtensionError(targetMode + ' (' + serverUrl + '): ' + errMsg);
    return;
  }

  const activeCode = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  await chrome.storage.local.set({ roomCode: activeCode });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (captureMode === 'desktop') {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'], tab, (streamId) => {
      if (!streamId) {
        statusEl.className = 'status';
        statusEl.textContent = 'Selección cancelada.';
        return;
      }
      statusEl.className = 'status';
      statusEl.textContent =
        targetMode === 'direct' ? 'Conectando directo al móvil...' : 'Conectando con el puente local...';
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'desktop',
          streamId,
          roomCode: activeCode,
          wsUrl: toWebSocketUrl(serverUrl, targetMode),
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
        updateUi(false, 'Error al capturar pestaña: ' + errMsg);
        await logExtensionError('tabCapture: ' + errMsg);
        return;
      }
      statusEl.className = 'status';
      statusEl.textContent =
        targetMode === 'direct' ? 'Conectando directo al móvil...' : 'Conectando con el puente local...';
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'tab',
          streamId,
          roomCode: activeCode,
          wsUrl: toWebSocketUrl(serverUrl, targetMode),
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
  const data = await chrome.storage.local.get([
    'roomCode',
    'targetMode',
    'directUrl',
    'bridgeUrl',
    'streaming',
    'captureMode',
    'errorLogs',
  ]);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const activeTarget = data.targetMode === 'bridge' ? 'bridge' : 'direct';
  const activeUrl =
    activeTarget === 'direct' ? (data.directUrl || 'sin detectar') : (data.bridgeUrl || DEFAULT_SERVER_URL);
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    'Versión: v' + manifestVersion + ' (' + EXT_BUILD_DATE + ')',
    'Conexión: ' + activeTarget,
    'Destino: ' + activeUrl,
    'Modo captura: ' + (data.captureMode || 'desktop'),
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
      justification: 'Streaming de audio del navegador por WebRTC/WebSocket local hacia el smartphone.',
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

  const pcmWorkletJs = `const PACKET_HEADER_BYTES = 16;
const TARGET_FRAMES = 256; // 5.33 ms @ 48 kHz

class WaveBridgePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seq = 0;
    this.batchLeft = new Float32Array(TARGET_FRAMES);
    this.batchRight = new Float32Array(TARGET_FRAMES);
    this.batchOffset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    if (!left || left.length === 0) return true;
    const right = input.length > 1 && input[1] ? input[1] : left;
    const frameCount = left.length;

    let idx = 0;
    while (idx < frameCount) {
      const remaining = TARGET_FRAMES - this.batchOffset;
      const take = Math.min(remaining, frameCount - idx);
      for (let i = 0; i < take; i++) {
        this.batchLeft[this.batchOffset + i] = left[idx + i];
        this.batchRight[this.batchOffset + i] = right[idx + i];
      }
      this.batchOffset += take;
      idx += take;
      if (this.batchOffset >= TARGET_FRAMES) {
        this.flushPacket();
      }
    }
    return true;
  }

  flushPacket() {
    const frames = this.batchOffset;
    if (frames === 0) return;

    const buffer = new ArrayBuffer(PACKET_HEADER_BYTES + frames * 4);
    const view = new DataView(buffer);
    view.setUint16(0, 0x5742, true);
    view.setUint32(2, this.seq++ >>> 0, true);
    view.setUint32(6, Math.round(currentTime * 1000) >>> 0, true);
    view.setUint32(10, sampleRate >>> 0, true);
    view.setUint8(14, 2);
    view.setUint8(15, 0);

    let offset = PACKET_HEADER_BYTES;
    for (let i = 0; i < frames; i++) {
      const l = this.batchLeft[i];
      const r = this.batchRight[i];
      const cl = l < -1 ? -1 : l > 1 ? 1 : l;
      const cr = r < -1 ? -1 : r > 1 ? 1 : r;
      view.setInt16(offset, cl < 0 ? cl * 0x8000 : cl * 0x7fff, true);
      view.setInt16(offset + 2, cr < 0 ? cr * 0x8000 : cr * 0x7fff, true);
      offset += 4;
    }

    this.batchOffset = 0;
    this.port.postMessage(buffer, [buffer]);
  }
}

registerProcessor('wavebridge-pcm-processor', WaveBridgePcmProcessor);`;

  const offscreenJs = `let activeStream = null;
let audioCtx = null;
let audioNode = null;
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
  const isDirect = /:8765(\\/|$)/.test(wsUrl);
  try {
    const httpUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\\/ws$/, '/api/health');
    const res = await fetch(httpUrl);
    if (!res.ok) {
      return isDirect
        ? 'WebSocket HTTP ' + res.status + ' en móvil (' + wsUrl + ').'
        : 'WebSocket HTTP ' + res.status + ' en ' + wsUrl + ': verifica el puente local en puerto 3000.';
    }
    return 'WebSocket falló en ' + wsUrl + ' (salud HTTP ' + res.status + ').';
  } catch {
    return isDirect
      ? 'No se pudo conectar con tu móvil en ' + wsUrl + '. Abre la app WaveBridge en Android (Wi-Fi) o cambia a "Puente PC (Plan B)".'
      : 'No se pudo conectar con ' + wsUrl + '. Verifica que "python3 bridge.py" esté ejecutándose en tu laptop.';
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

      const silentSink = audioCtx.createGain();
      silentSink.gain.value = 0;

      const sendBinaryIfReady = (packetBuffer) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || activeReceivers.length === 0) return;
        const needsWs = activeReceivers.some((r) => r.transportMode !== 'webrtc');
        if (!needsWs || socket.bufferedAmount > 16384) return;
        socket.send(packetBuffer);
      };

      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
        const workletNode = new AudioWorkletNode(audioCtx, 'wavebridge-pcm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          channelCountMode: 'explicit',
        });
        workletNode.port.onmessage = (ev) => sendBinaryIfReady(ev.data);
        audioNode = workletNode;
        src.connect(workletNode);
        workletNode.connect(silentSink);
      } else {
        const processor = audioCtx.createScriptProcessor(256, 2, 2);
        processor.onaudioprocess = (ev) => {
          if (!socket || socket.readyState !== WebSocket.OPEN || activeReceivers.length === 0) return;
          const needsWs = activeReceivers.some((r) => r.transportMode !== 'webrtc');
          if (!needsWs || socket.bufferedAmount > 16384) return;
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
        audioNode = processor;
        src.connect(processor);
        processor.connect(silentSink);
      }
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
            iceServers: [],
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
  if (audioNode) {
    try {
      audioNode.disconnect();
      if (audioNode.port) audioNode.port.onmessage = null;
    } catch {
      // ignore
    }
    audioNode = null;
  }
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
      description: 'Manifest V3 local-only con desktopCapture y tabCapture',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'popup.html',
      language: 'html',
      description: 'Modo Directo al móvil (:8765) y Plan B puente PC (:3000) con diagnóstico',
      content: popupHtml,
    },
    {
      path: 'popup.js',
      language: 'javascript',
      description: 'Busca móvil Android en Wi-Fi (:8765/api/health) o usa puente PC (:3000)',
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
      description: 'Contenedor offscreen requerido por Chrome MV3 para WebRTC/WS local',
      content: offscreenHtml,
    },
    {
      path: 'offscreen.js',
      language: 'javascript',
      description: 'Captura el audio del navegador con AudioWorklet y transmite directo a Android o vía puente local',
      content: offscreenJs,
    },
    {
      path: 'pcm-worklet.js',
      language: 'javascript',
      description: 'AudioWorkletProcessor en hilo de audio dedicado (bloques de 5.3 ms sin bloquear UI)',
      content: pcmWorkletJs,
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
