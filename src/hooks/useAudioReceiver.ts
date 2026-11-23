import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeJitterStats,
  decodeAudioPacket,
  isValidRoomCode,
  LATENCY_PRESETS,
  LatencyPresetId,
  normalizeRoomCode,
  StreamMetadata,
} from '../lib/bridgeProtocol';

export interface ReceiverStatus {
  connected: boolean;
  connecting: boolean;
  senderConnected: boolean;
  senderDeviceName: string | null;
  roomCode: string;
  transportMode: 'webrtc' | 'websocket' | 'waiting';
  rttMs: number | null;
  jitterMs: number;
  packetLossPct: number;
  packetsReceived: number;
  volume: number;
  muted: boolean;
  latencyPreset: LatencyPresetId;
  wakeLockActive: boolean;
  streamMetadata: StreamMetadata | null;
  error: string | null;
}

export function useAudioReceiver(initialRoomCode = '') {
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(initialRoomCode));
  const [deviceName, setDeviceName] = useState('Smartphone Android');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [senderConnected, setSenderConnected] = useState(false);
  const [senderDeviceName, setSenderDeviceName] = useState<string | null>(null);
  const [transportMode, setTransportMode] = useState<'webrtc' | 'websocket' | 'waiting'>('waiting');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState(0);
  const [packetLossPct, setPacketLossPct] = useState(0);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [muted, setMuted] = useState(false);
  const [latencyPreset, setLatencyPreset] = useState<LatencyPresetId>('balanced');
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [streamMetadata, setStreamMetadata] = useState<StreamMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  const rttHistoryRef = useRef<number[]>([]);
  const seqHistoryRef = useRef<number[]>([]);
  const latencyPresetRef = useRef(latencyPreset);
  latencyPresetRef.current = latencyPreset;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const ensureAudioGraph = useCallback(async () => {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      const gain = ctx.createGain();
      gain.gain.value = mutedRef.current ? 0 : volumeRef.current;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;

      gain.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
      analyserRef.current = analyser;
      nextPlayTimeRef.current = ctx.currentTime + 0.04;
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setWakeLockActive(true);
        wakeLockRef.current.addEventListener('release', () => setWakeLockActive(false));
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    gainNodeRef.current = null;
    analyserRef.current = null;
    releaseWakeLock();
    setConnected(false);
    setConnecting(false);
    setSenderConnected(false);
    setSenderDeviceName(null);
    setTransportMode('waiting');
    setStreamMetadata(null);
  }, [releaseWakeLock]);

  const schedulePcmPacket = useCallback((rawBuffer: ArrayBuffer) => {
    const packet = decodeAudioPacket(rawBuffer);
    const ctx = audioCtxRef.current;
    const gainNode = gainNodeRef.current;
    if (!packet || !ctx || !gainNode) return;

    seqHistoryRef.current.push(packet.seq);
    if (seqHistoryRef.current.length > 64) seqHistoryRef.current.shift();
    setPacketsReceived((n) => n + 1);

    const frameCount = Math.floor(packet.samples.length / packet.channels);
    if (frameCount <= 0) return;

    const audioBuffer = ctx.createBuffer(packet.channels, frameCount, packet.sampleRate);
    for (let ch = 0; ch < packet.channels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = packet.samples[i * packet.channels + ch];
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(gainNode);

    const targetDelaySec = LATENCY_PRESETS[latencyPresetRef.current].targetLatencyMs / 1000;
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now || nextPlayTimeRef.current - now > targetDelaySec + 0.16) {
      nextPlayTimeRef.current = now + targetDelaySec;
    }
    src.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
  }, []);

  const connect = useCallback(
    async (codeOverride?: string) => {
      const targetCode = normalizeRoomCode(codeOverride ?? roomCode);
      if (!isValidRoomCode(targetCode)) {
        setError('Ingresa un código válido de 6 caracteres (ej. WVB-492).');
        return;
      }

      disconnect();
      setRoomCode(targetCode);
      setConnecting(true);
      setError(null);
      rttHistoryRef.current = [];
      seqHistoryRef.current = [];
      setPacketsReceived(0);

      await ensureAudioGraph();
      await requestWakeLock();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);
        ws.send(
          JSON.stringify({
            type: 'join',
            room: targetCode,
            role: 'receiver',
            deviceName,
          })
        );

        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
          }
        }, 2000);
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          setTransportMode((prev) => (prev === 'webrtc' ? prev : 'websocket'));
          schedulePcmPacket(event.data);
          return;
        }

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.type === 'error') {
          setError(String(msg.message || 'Error de conexión'));
        } else if (msg.type === 'room-presence') {
          setSenderConnected(Boolean(msg.senderConnected));
          setSenderDeviceName(
            typeof msg.senderDeviceName === 'string' ? msg.senderDeviceName : null
          );
          if (msg.streamState) {
            setStreamMetadata(msg.streamState as StreamMetadata);
          }
        } else if (msg.type === 'sender-left') {
          setSenderConnected(false);
          setSenderDeviceName(null);
          setStreamMetadata(null);
          setTransportMode('waiting');
        } else if (msg.type === 'stream-state') {
          setStreamMetadata((msg.state as StreamMetadata) || null);
        } else if (msg.type === 'pong' && typeof msg.clientTime === 'number') {
          const rtt = Math.max(1, Math.round(performance.now() - msg.clientTime));
          rttHistoryRef.current.push(rtt);
          if (rttHistoryRef.current.length > 20) rttHistoryRef.current.shift();
          const stats = computeJitterStats(rttHistoryRef.current, seqHistoryRef.current);
          setRttMs(stats.avgRttMs);
          setJitterMs(stats.jitterMs);
          setPacketLossPct(stats.packetLossPct);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'transport-status',
                rttMs: stats.avgRttMs,
                mode: pcRef.current?.connectionState === 'connected' ? 'webrtc' : 'websocket',
              })
            );
          }
        } else if (msg.type === 'signal' && typeof msg.fromId === 'string') {
          const payload = msg.payload as {
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
          };
          if (!payload) return;

          if (payload.sdp && payload.sdp.type === 'offer') {
            if (pcRef.current) {
              pcRef.current.close();
            }
            const pc = new RTCPeerConnection({
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });
            pcRef.current = pc;

            pc.onicecandidate = (ev) => {
              if (ev.candidate && ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'signal',
                    targetId: msg.fromId,
                    payload: { candidate: ev.candidate },
                  })
                );
              }
            };

            pc.onconnectionstatechange = () => {
              if (pc.connectionState === 'connected') {
                setTransportMode('webrtc');
                ws.send(JSON.stringify({ type: 'transport-status', mode: 'webrtc' }));
              }
            };

            pc.ontrack = async (ev) => {
              const stream = ev.streams[0] || new MediaStream([ev.track]);
              const ctx = await ensureAudioGraph();
              if (gainNodeRef.current) {
                const src = ctx.createMediaStreamSource(stream);
                src.connect(gainNodeRef.current);
              }
              // Keep muted hidden HTMLAudioElement attached so Chrome plays WebRTC remote track smoothly
              const audioEl = new Audio();
              audioEl.srcObject = stream;
              audioEl.muted = true;
              audioEl.play().catch(() => undefined);
              audioElRef.current = audioEl;
              setTransportMode('webrtc');
            };

            try {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(
                JSON.stringify({
                  type: 'signal',
                  targetId: msg.fromId,
                  payload: { sdp: pc.localDescription },
                })
              );
            } catch (err) {
              console.warn('WebRTC answer failed, using WebSocket audio fallback:', err);
            }
          } else if (payload.candidate && pcRef.current) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => undefined);
          }
        }
      };

      ws.onerror = () => {
        setError('No se pudo conectar al servidor de puente Wi-Fi.');
        setConnecting(false);
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
      };
    },
    [roomCode, deviceName, disconnect, ensureAudioGraph, requestWakeLock, schedulePcmPacket]
  );

  // Sync volume & mute live
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const target = muted ? 0 : volume;
      gainNodeRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.015);
    }
  }, [volume, muted]);

  // Android / Bluetooth MediaSession controls (allows pausing/muting from wireless headphones!)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (connected) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: streamMetadata?.sourceLabel || 'Audio del navegador',
        artist: 'WaveBridge Wi-Fi',
        album: `Sala ${roomCode}`,
      });
      navigator.mediaSession.playbackState = muted ? 'paused' : 'playing';
      navigator.mediaSession.setActionHandler('play', () => setMuted(false));
      navigator.mediaSession.setActionHandler('pause', () => setMuted(true));
      navigator.mediaSession.setActionHandler('stop', () => disconnect());
    }
  }, [connected, muted, roomCode, streamMetadata, disconnect]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    status: {
      connected,
      connecting,
      senderConnected,
      senderDeviceName,
      roomCode,
      transportMode,
      rttMs,
      jitterMs,
      packetLossPct,
      packetsReceived,
      volume,
      muted,
      latencyPreset,
      wakeLockActive,
      streamMetadata,
      error,
    } satisfies ReceiverStatus,
    deviceName,
    setDeviceName,
    analyserRef,
    setRoomCode,
    setVolume,
    setMuted,
    setLatencyPreset,
    connect,
    disconnect,
  };
}
