let activeStream = null;
let audioCtx = null;
let socket = null;
let seq = 0;
const peers = new Map();
let activeReceivers = [];

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

      audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      const src = audioCtx.createMediaStreamSource(activeStream);
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
      socket.onerror = () => reportError(`WebSocket error al conectar con ${msg.wsUrl}`);
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'join',
            room: msg.roomCode,
            role: 'sender',
            deviceName: 'Extensión Chrome',
          })
        );
        socket.send(
          JSON.stringify({
            type: 'stream-state',
            state: {
              active: true,
              source: 'tab',
              sourceLabel: 'Pestaña de Chrome (Extensión)',
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
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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
      reportError(`offscreen capture: ${err?.message || String(err)}`);
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
}
