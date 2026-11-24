let activeStream = null;
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
  const isDirect = /:8765(\/|$)/.test(wsUrl);
  try {
    const httpUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/ws$/, '/api/health');
    const res = await fetch(httpUrl);
    if (!res.ok) {
      return isDirect
        ? `WebSocket HTTP ${res.status} en móvil (${wsUrl}).`
        : `WebSocket HTTP ${res.status} en ${wsUrl}: verifica el puente local en puerto 3000.`;
    }
    return `WebSocket falló en ${wsUrl} (salud HTTP ${res.status}).`;
  } catch {
    return isDirect
      ? `No se pudo conectar con tu móvil en ${wsUrl}. Abre la app WaveBridge en Android (Wi-Fi) o cambia a "Puente PC (Plan B)".`
      : `No se pudo conectar con ${wsUrl}. Verifica que "python3 bridge.py" esté ejecutándose en tu laptop.`;
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
        if (!needsWs) return;
        if (socket.bufferedAmount > 16384) return;
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
          ? `Conexión WebSocket cerrada (código ${ev.code}).`
          : await diagnoseWebSocketFailure(msg.wsUrl);
        reportError(detail);
        cleanup();
        chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED', errorMessage: detail });
      };

      socket.onopen = () => {
        wsConnectedOnce = true;
        chrome.runtime.sendMessage({ type: 'CAPTURE_CONNECTED' });
        socket.send(
          JSON.stringify({
            type: 'join',
            room: msg.roomCode,
            role: 'sender',
            deviceName: msg.sourceKind === 'desktop' ? 'Chrome Todo el Navegador' : 'Extensión Chrome',
          })
        );
        socket.send(
          JSON.stringify({
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
          })
        );
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
              socket.send(
                JSON.stringify({
                  type: 'signal',
                  targetId: data.peerId,
                  payload: { candidate: e.candidate },
                })
              );
            }
          };
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.send(
            JSON.stringify({
              type: 'signal',
              targetId: data.peerId,
              payload: { sdp: pc.localDescription },
            })
          );
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
      const errMsg = `offscreen capture: ${err?.message || String(err)}`;
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
}
