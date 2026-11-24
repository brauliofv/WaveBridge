const LOCAL_BRIDGE_URL = 'http://localhost:3000';
const ANDROID_DIRECT_PORT = 8765;
const EXT_BUILD_DATE = '2026-11-23';

const toggleNetBtn = document.getElementById('toggleNetBtn');
const networkBody = document.getElementById('networkBody');
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
const extVolumeSlider = document.getElementById('extVolumeSlider');
const extVolumeLabel = document.getElementById('extVolumeLabel');
const pcMuteWrap = document.getElementById('pcMuteWrap');
const pcMuteBtn = document.getElementById('pcMuteBtn');
const versionMetaEl = document.getElementById('versionMeta');
const copyDiagBtn = document.getElementById('copyDiagBtn');

const manifestVersion = chrome.runtime.getManifest().version || '1.0.5';
versionMetaEl.textContent = `v${manifestVersion} · ${EXT_BUILD_DATE}`;

let captureMode = 'desktop';
let targetMode = 'direct';
let extVolumePct = 100;
let pcMuted = true;
let isStreamingNow = false;
let networkExpandedOverride = null;

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

function normalizeTargetUrl(rawValue, mode = targetMode) {
  const clean = (rawValue || '').trim().replace(/\/+$/, '');
  if (!clean) {
    return mode === 'bridge' ? LOCAL_BRIDGE_URL : '';
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
  return wsBase.endsWith('/ws') ? wsBase : `${wsBase}/ws`;
}

async function logExtensionError(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push(`[${new Date().toISOString()}] ${message}`);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
  copyDiagBtn.textContent = `Diagnóstico (${Math.min(logs.length, 15)})`;
}

async function probeDirectAndroidHealth(baseUrl, timeoutMs = 450) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
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
        const match = cand.match(/\b((?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1]))\.\d{1,3})\.\d{1,3}\b/);
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
      serverStatusEl.textContent = `Buscando Android en ${prefix}.x:8765...`;
      const hosts = [];
      for (let i = 2; i <= 254; i++) {
        hosts.push(`${prefix}.${i}`);
      }
      for (let i = 0; i < hosts.length; i += 32) {
        const batch = hosts.slice(i, i + 32);
        const results = await Promise.all(
          batch.map((ip) => probeDirectAndroidHealth(`http://${ip}:${ANDROID_DIRECT_PORT}`, 380))
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
  const devName = json.deviceName ? `${json.deviceName} · ` : '';
  const roomSuffix = detectedRoom ? ` · Sala ${detectedRoom}` : '';
  serverStatusEl.className = 'server-status ok';
  serverStatusEl.textContent = `Móvil listo: ${devName}${baseUrl}${roomSuffix}`;
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
    mode === 'direct' ? `Verificando móvil en ${baseUrl}...` : 'Probando puente local...';
  if (mode === 'direct') {
    lanBoxEl.className = 'lan-box';
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      serverStatusEl.className = 'server-status err';
      serverStatusEl.textContent = `Respondió HTTP ${res.status} en ${baseUrl}.`;
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
        const netRes = await fetch(`${baseUrl}/api/network-info`);
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
        ? `Puente PC activo (${json.runtime || 'node'})`
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
    const errDetail = err && (err.name || err.message) ? ` [${err.name || 'Error'}: ${err.message || ''}]` : '';
    lanBoxEl.className = 'lan-box';
    serverStatusEl.className = 'server-status err';
    serverStatusEl.textContent =
      mode === 'direct'
        ? `No responde ${baseUrl}${errDetail}. Abre WaveBridge en Android y pulsa Buscar móvil (o usa Puente PC Plan B).`
        : `Puente local apagado${errDetail}. Ejecuta "python3 bridge.py" (Plan B) o "npm run web" (Plan C).`;
    return false;
  }
}

function updateAudioControlsUi() {
  extVolumeSlider.value = String(extVolumePct);
  extVolumeLabel.textContent = `${extVolumePct}%`;
  if (captureMode === 'tab') {
    pcMuteWrap.className = 'pc-mute-wrap visible';
    pcMuteBtn.className = pcMuted ? 'pc-mute-btn muted' : 'pc-mute-btn';
    pcMuteBtn.textContent = pcMuted
      ? 'Audio en PC: Silenciado (sin eco)'
      : 'Audio en PC: Sonando en laptop';
  } else {
    pcMuteWrap.className = 'pc-mute-wrap';
  }
}

function pushLiveAudioControls() {
  chrome.runtime
    .sendMessage({
      target: 'offscreen',
      type: 'SET_AUDIO_CONTROL',
      extVolume: extVolumePct / 100,
      pcMuted,
    })
    .catch(() => undefined);
}

extVolumeSlider.addEventListener('input', () => {
  extVolumePct = Math.max(0, Math.min(150, Number(extVolumeSlider.value) || 0));
  extVolumeLabel.textContent = `${extVolumePct}%`;
  chrome.storage.local.set({ extVolume: extVolumePct });
  pushLiveAudioControls();
});

pcMuteBtn.addEventListener('click', () => {
  if (captureMode !== 'tab') return;
  pcMuted = !pcMuted;
  chrome.storage.local.set({ pcMuted });
  updateAudioControlsUi();
  pushLiveAudioControls();
});

toggleNetBtn.addEventListener('click', () => {
  const currentlyOpen = networkBody.style.display !== 'none';
  networkExpandedOverride = !currentlyOpen;
  applyNetworkCollapseUi();
});

function applyNetworkCollapseUi() {
  if (!isStreamingNow) {
    networkExpandedOverride = null;
    toggleNetBtn.className = 'collapse-btn';
    networkBody.style.display = 'block';
    return;
  }
  toggleNetBtn.className = 'collapse-btn visible';
  const show = networkExpandedOverride === true;
  networkBody.style.display = show ? 'block' : 'none';
  toggleNetBtn.textContent = show ? 'Ocultar red ▴' : 'Ajustar red ▾';
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
          : LOCAL_BRIDGE_URL;
    }
    checkServerReachability(serverInput.value || LOCAL_BRIDGE_URL, 'bridge');
  }
}

function setCaptureMode(mode, persist = true) {
  captureMode = mode === 'tab' ? 'tab' : 'desktop';
  if (persist) {
    chrome.storage.local.set({ captureMode });
  }
  modeDesktopBtn.className = captureMode === 'desktop' ? 'mode-btn active' : 'mode-btn';
  modeTabBtn.className = captureMode === 'tab' ? 'mode-btn active' : 'mode-btn';
  hintEl.textContent =
    captureMode === 'desktop'
      ? 'Elige "Pantalla completa" y marca "Compartir también el audio del sistema" para escuchar todas tus pestañas y notificaciones.'
      : 'Captura solo la pestaña actual aunque cambies de ventana. Puedes silenciarla en la laptop sin quitar el sonido al sistema.';
  updateAudioControlsUi();
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
  setTargetMode('bridge', { bridgeUrl: data.bridgeUrl || LOCAL_BRIDGE_URL });
});

modeDesktopBtn.addEventListener('click', () => {
  if (isStreamingNow) return;
  setCaptureMode('desktop', true);
});
modeTabBtn.addEventListener('click', () => {
  if (isStreamingNow) return;
  setCaptureMode('tab', true);
});

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
  [
    'roomCode',
    'targetMode',
    'directUrl',
    'bridgeUrl',
    'streaming',
    'captureMode',
    'extVolume',
    'pcMuted',
    'errorLogs',
    'lastError',
  ],
  (data) => {
    roomInput.value = data.roomCode || randomCode();
    extVolumePct = typeof data.extVolume === 'number' ? Math.max(0, Math.min(150, data.extVolume)) : 100;
    pcMuted = data.pcMuted !== false;
    captureMode = data.captureMode === 'tab' ? 'tab' : 'desktop';
    setTargetMode(data.targetMode === 'bridge' ? 'bridge' : 'direct', data);
    setCaptureMode(captureMode, false);
    updateAudioControlsUi();
    updateUi(Boolean(data.streaming), data.lastError || '');
    if (Array.isArray(data.errorLogs) && data.errorLogs.length > 0) {
      copyDiagBtn.textContent = `Diagnóstico (${data.errorLogs.length})`;
    }
  }
);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS_CHANGED') {
    updateUi(Boolean(msg.streaming), msg.errorMessage || '');
  } else if (msg.type === 'RECONNECT_STATUS') {
    statusEl.className = 'status warn';
    statusEl.textContent = `Reconectando Wi-Fi (${msg.attempt}/${msg.maxAttempts})...`;
  }
});

function updateUi(streaming, errorMessage) {
  isStreamingNow = streaming;
  modeDesktopBtn.disabled = streaming;
  modeTabBtn.disabled = streaming;
  roomInput.disabled = streaming;
  applyNetworkCollapseUi();

  toggleBtn.textContent = streaming
    ? 'Detener transmisión'
    : captureMode === 'desktop'
      ? 'Transmitir todo el navegador'
      : 'Transmitir pestaña activa';
  toggleBtn.className = streaming ? 'primary stop' : 'primary';

  if (streaming) {
    statusEl.className = 'status ok';
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
      await logExtensionError(`Directo Wi-Fi: ${errMsg}`);
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
    extVolume: extVolumePct,
    pcMuted,
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
    await logExtensionError(`${targetMode} (${serverUrl}): ${errMsg}`);
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
          extVolume: extVolumePct / 100,
          pcMuted: false,
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
      statusEl.textContent =
        targetMode === 'direct' ? 'Conectando directo al móvil...' : 'Conectando con el puente local...';
      chrome.runtime.sendMessage(
        {
          type: 'START_CAPTURE',
          sourceKind: 'tab',
          streamId,
          roomCode: activeCode,
          wsUrl: toWebSocketUrl(serverUrl, targetMode),
          extVolume: extVolumePct / 100,
          pcMuted,
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
    'extVolume',
    'pcMuted',
    'errorLogs',
  ]);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  const activeTarget = data.targetMode === 'bridge' ? 'bridge' : 'direct';
  const activeUrl =
    activeTarget === 'direct' ? data.directUrl || 'sin detectar' : data.bridgeUrl || LOCAL_BRIDGE_URL;
  const activeMode = data.captureMode || 'desktop';
  const report = [
    '=== WaveBridge Extensión Diagnóstico ===',
    `Versión: v${manifestVersion} (${EXT_BUILD_DATE})`,
    `Conexión: ${activeTarget}`,
    `Destino: ${activeUrl}`,
    `Modo captura: ${activeMode}`,
    `Volumen envío: ${typeof data.extVolume === 'number' ? data.extVolume : 100}%`,
    activeMode === 'tab' ? `Audio en PC (pestaña): ${data.pcMuted !== false ? 'silenciado' : 'activo'}` : null,
    `Sala: ${data.roomCode || 'N/A'}`,
    `Transmitiendo: ${data.streaming ? 'sí' : 'no'}`,
    `Navegador: ${navigator.userAgent}`,
    '',
    logs.length > 0 ? `Errores recientes:\n${logs.join('\n')}` : 'Sin errores recientes.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  await navigator.clipboard.writeText(report);
  copyDiagBtn.textContent = 'Copiado';
  setTimeout(() => {
    copyDiagBtn.textContent = logs.length > 0 ? `Diagnóstico (${logs.length})` : 'Reportar error';
  }, 1800);
});
