import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioSourceType,
  CODEC_PROFILES,
  CodecProfileId,
  ConnectedReceiverInfo,
  encodeAudioPacket,
  generateRoomCode,
  LatencyPresetId,
  StreamMetadata,
} from '../lib/bridgeProtocol';

export interface SenderStatus {
  wsConnected: boolean;
  roomCode: string;
  streaming: boolean;
  source: AudioSourceType;
  sourceLabel: string;
  codec: CodecProfileId;
  latencyPreset: LatencyPresetId;
  gain: number;
  muted: boolean;
  monitorLocally: boolean;
  receivers: ConnectedReceiverInfo[];
  error: string | null;
  sampleRate: number;
}

const SOURCE_LABELS: Record<AudioSourceType, string> = {
  tab: 'Todo el navegador / Sistema',
  synth: 'Generador estéreo de prueba',
  mic: 'Micrófono / Entrada de línea',
};

function tuneOpusSdp(sdp: string, bitrateKbps: number): string {
  const bps = bitrateKbps * 1000;
  return sdp.replace(
    /a=fmtp:111 ([^\r\n]+)/g,
    (_match, params: string) => {
      const cleaned = params
        .replace(/;?maxaveragebitrate=\d+/g, '')
        .replace(/;?stereo=\d+/g, '')
        .replace(/;?sprop-stereo=\d+/g, '');
      return `a=fmtp:111 ${cleaned};stereo=1;sprop-stereo=1;maxaveragebitrate=${bps};useinbandfec=1`;
    }
  );
}

export function useAudioSender(initialRoomCode?: string) {
  const [roomCode, setRoomCode] = useState<string>(() => initialRoomCode || generateRoomCode());
  const [wsConnected, setWsConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [source, setSource] = useState<AudioSourceType>('tab');
  const [codec, setCodec] = useState<CodecProfileId>('opus-256');
  const [latencyPreset, setLatencyPreset] = useState<LatencyPresetId>('balanced');
  const [gain, setGain] = useState(1.0);
  const [muted, setMuted] = useState(false);
  const [monitorLocally, setMonitorLocally] = useState(false);
  const [receivers, setReceivers] = useState<ConnectedReceiverInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState(48000);

  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const synthTimersRef = useRef<number[]>([]);
  const synthStopRef = useRef<(() => void) | null>(null);
  const seqRef = useRef(0);

  // Keep latest reactive values in refs for audio/WS callbacks
  const stateRef = useRef({
    streaming,
    source,
    codec,
    latencyPreset,
    muted,
    gain,
    monitorLocally,
    receivers,
  });
  stateRef.current = {
    streaming,
    source,
    codec,
    latencyPreset,
    muted,
    gain,
    monitorLocally,
    receivers,
  };

  const broadcastStreamState = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s = stateRef.current;
    const metadata: StreamMetadata = {
      active: s.streaming,
      source: s.source,
      sourceLabel: SOURCE_LABELS[s.source],
      codec: s.codec,
      latencyPreset: s.latencyPreset,
      sampleRate: audioCtxRef.current?.sampleRate ?? 48000,
      channels: 2,
      muted: s.muted,
    };
    ws.send(JSON.stringify({ type: 'stream-state', state: metadata }));
  }, []);

  const createPeerForReceiver = useCallback(
    async (peerId: string) => {
      const ws = wsRef.current;
      const destStream = mediaDestRef.current?.stream;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const existing = peersRef.current.get(peerId);
      if (existing) {
        existing.close();
        peersRef.current.delete(peerId);
      }

      if (!destStream) return;

      const pc = new RTCPeerConnection({
        iceServers: [],
      });
      peersRef.current.set(peerId, pc);

      for (const track of destStream.getAudioTracks()) {
        pc.addTrack(track, destStream);
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'signal',
              targetId: peerId,
              payload: { candidate: ev.candidate },
            })
          );
        }
      };

      try {
        const offer = await pc.createOffer();
        const profile = CODEC_PROFILES[stateRef.current.codec];
        if (offer.sdp && profile.transport === 'webrtc') {
          offer.sdp = tuneOpusSdp(offer.sdp, profile.bitrateKbps);
        }
        await pc.setLocalDescription(offer);
        ws.send(
          JSON.stringify({
            type: 'signal',
            targetId: peerId,
            payload: { sdp: pc.localDescription },
          })
        );
      } catch (err) {
        console.warn('WebRTC offer creation failed, WebSocket relay remains active:', err);
      }
    },
    []
  );

  // Manage WebSocket signaling room connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let closedByUser = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setError(null);
        ws.send(
          JSON.stringify({
            type: 'join',
            room: roomCode,
            role: 'sender',
            deviceName: 'Navegador Laptop',
          })
        );
        broadcastStreamState();
      };

      ws.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'room-presence' && Array.isArray(msg.receivers)) {
          setReceivers(msg.receivers as ConnectedReceiverInfo[]);
        } else if (msg.type === 'receiver-joined' && typeof msg.peerId === 'string') {
          broadcastStreamState();
          if (stateRef.current.streaming && stateRef.current.codec !== 'pcm-raw') {
            await createPeerForReceiver(msg.peerId);
          }
        } else if (msg.type === 'receiver-left' && typeof msg.peerId === 'string') {
          const pc = peersRef.current.get(msg.peerId);
          if (pc) {
            pc.close();
            peersRef.current.delete(msg.peerId);
          }
        } else if (msg.type === 'signal' && typeof msg.fromId === 'string') {
          const pc = peersRef.current.get(msg.fromId);
          const payload = msg.payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          if (!pc || !payload) return;
          try {
            if (payload.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            } else if (payload.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
          } catch (err) {
            console.warn('Error applying signaling message:', err);
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        peersRef.current.forEach((pc) => pc.close());
        peersRef.current.clear();
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomCode, broadcastStreamState, createPeerForReceiver]);

  // Update gain / mute / monitor parameters live
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const target = muted ? 0 : gain;
      gainNodeRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.015);
    }
  }, [gain, muted]);

  useEffect(() => {
    if (monitorGainRef.current && audioCtxRef.current) {
      const target = monitorLocally ? 0.65 : 0;
      monitorGainRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.02);
    }
  }, [monitorLocally]);

  useEffect(() => {
    broadcastStreamState();
  }, [streaming, source, codec, latencyPreset, muted, broadcastStreamState]);

  const stopStreaming = useCallback(() => {
    synthTimersRef.current.forEach((id) => window.clearInterval(id));
    synthTimersRef.current = [];
    synthStopRef.current?.();
    synthStopRef.current = null;

    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((t) => t.stop());
      captureStreamRef.current = null;
    }

    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }

    gainNodeRef.current = null;
    monitorGainRef.current = null;
    analyserRef.current = null;
    mediaDestRef.current = null;
    setStreaming(false);
  }, []);

  const startTestSynth = (ctx: AudioContext, targetNode: AudioNode): (() => void) => {
    const masterSynthGain = ctx.createGain();
    masterSynthGain.gain.value = 0.28;
    masterSynthGain.connect(targetNode);

    const chords = [
      [261.63, 329.63, 392.0, 493.88], // Cmaj7
      [220.0, 261.63, 329.63, 392.0], // Am7
      [174.61, 220.0, 261.63, 349.23], // Fmaj7
      [196.0, 246.94, 293.66, 392.0], // G6
    ];
    let step = 0;
    const activeOscs = new Set<OscillatorNode>();

    const triggerChord = () => {
      const chord = chords[step % chords.length];
      step++;
      const now = ctx.currentTime;

      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
        env.gain.exponentialRampToValueAtTime(0.001, now + 1.45);
        osc.connect(env);
        env.connect(masterSynthGain);
        osc.start(now);
        osc.stop(now + 1.5);
        activeOscs.add(osc);
        osc.onended = () => activeOscs.delete(osc);
      });

      // Subtle rhythmic pulse so latency & stereo sync are easy to verify by ear
      const pulse = ctx.createOscillator();
      const pulseEnv = ctx.createGain();
      pulse.type = 'sine';
      pulse.frequency.setValueAtTime(880, now);
      pulse.frequency.exponentialRampToValueAtTime(440, now + 0.08);
      pulseEnv.gain.setValueAtTime(0.22, now);
      pulseEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      pulse.connect(pulseEnv);
      pulseEnv.connect(masterSynthGain);
      pulse.start(now);
      pulse.stop(now + 0.14);
      activeOscs.add(pulse);
      pulse.onended = () => activeOscs.delete(pulse);
    };

    triggerChord();
    const timer = window.setInterval(triggerChord, 1500);
    synthTimersRef.current.push(timer);

    return () => {
      activeOscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          // ignore
        }
      });
      activeOscs.clear();
    };
  };

  const startStreaming = useCallback(
    async (selectedSource?: AudioSourceType) => {
      const targetSource = selectedSource ?? source;
      setError(null);
      stopStreaming();

      try {
        const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        audioCtxRef.current = ctx;
        setSampleRate(ctx.sampleRate);

        const gainNode = ctx.createGain();
        gainNode.gain.value = stateRef.current.muted ? 0 : stateRef.current.gain;
        gainNodeRef.current = gainNode;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.78;
        analyserRef.current = analyser;

        const monitorGain = ctx.createGain();
        monitorGain.gain.value = stateRef.current.monitorLocally ? 0.65 : 0;
        monitorGainRef.current = monitorGain;

        const mediaDest = ctx.createMediaStreamDestination();
        mediaDestRef.current = mediaDest;

        // Low-latency PCM WebSocket relay processor (256 frames ~ 5.3 ms @ 48 kHz)
        const processor = ctx.createScriptProcessor(256, 2, 2);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0;

        processor.onaudioprocess = (ev) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const activeReceivers = stateRef.current.receivers;
          if (activeReceivers.length === 0) return;

          const needsWsAudio =
            stateRef.current.codec === 'pcm-raw' ||
            activeReceivers.some((r) => r.transportMode !== 'webrtc');
          if (!needsWsAudio || ws.bufferedAmount > 16384) return;

          const left = ev.inputBuffer.getChannelData(0);
          const right =
            ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : left;
          const interleaved = new Float32Array(left.length * 2);
          for (let i = 0; i < left.length; i++) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
          }
          const packet = encodeAudioPacket(
            interleaved,
            seqRef.current++,
            performance.now(),
            ctx.sampleRate,
            2
          );
          ws.send(packet);
        };

        gainNode.connect(analyser);
        analyser.connect(mediaDest);
        analyser.connect(monitorGain);
        monitorGain.connect(ctx.destination);
        analyser.connect(processor);
        processor.connect(silentSink);
        silentSink.connect(ctx.destination);

        if (targetSource === 'synth') {
          synthStopRef.current = startTestSynth(ctx, gainNode);
        } else if (targetSource === 'tab') {
          if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error(
              'Tu navegador actual no soporta captura de pestaña (getDisplayMedia). Usa Chrome en escritorio o el Generador de Prueba.'
            );
          }
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            // @ts-expect-error systemAudio is supported in Chromium getDisplayMedia
            systemAudio: 'include',
          });
          // Stop video track immediately so we only keep audio bandwidth & CPU low
          stream.getVideoTracks().forEach((vt) => vt.stop());
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error(
              'No marcaste "Compartir también el audio del sistema" (o audio de pestaña) en el diálogo de Chrome.'
            );
          }
          captureStreamRef.current = stream;
          audioTracks[0].onended = () => stopStreaming();
          const mediaSource = ctx.createMediaStreamSource(stream);
          mediaSource.connect(gainNode);
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Acceso a micrófono no disponible en este contexto.');
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          captureStreamRef.current = stream;
          const mediaSource = ctx.createMediaStreamSource(stream);
          mediaSource.connect(gainNode);
        }

        setSource(targetSource);
        setStreaming(true);

        // Initiate WebRTC offers for all currently connected receivers
        if (stateRef.current.codec !== 'pcm-raw') {
          for (const rec of stateRef.current.receivers) {
            await createPeerForReceiver(rec.id);
          }
        }
      } catch (err) {
        stopStreaming();
        const message =
          err instanceof Error ? err.message : 'No se pudo iniciar la captura de audio.';
        setError(message);
      }
    },
    [source, stopStreaming, createPeerForReceiver]
  );

  const regenerateRoomCode = useCallback(() => {
    stopStreaming();
    setReceivers([]);
    setRoomCode(generateRoomCode());
  }, [stopStreaming]);

  useEffect(() => {
    return () => stopStreaming();
  }, [stopStreaming]);

  return {
    status: {
      wsConnected,
      roomCode,
      streaming,
      source,
      sourceLabel: SOURCE_LABELS[source],
      codec,
      latencyPreset,
      gain,
      muted,
      monitorLocally,
      receivers,
      error,
      sampleRate,
    } satisfies SenderStatus,
    analyserRef,
    setSource,
    setCodec,
    setLatencyPreset,
    setGain,
    setMuted,
    setMonitorLocally,
    startStreaming,
    stopStreaming,
    regenerateRoomCode,
  };
}
