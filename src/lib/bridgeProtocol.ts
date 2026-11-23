export type BridgeRole = 'sender' | 'receiver';

export type AudioSourceType = 'tab' | 'synth' | 'mic';

export type LatencyPresetId = 'ultra' | 'balanced' | 'stable';

export type CodecProfileId = 'opus-256' | 'opus-128' | 'pcm-raw';

export interface LatencyPreset {
  id: LatencyPresetId;
  label: string;
  targetLatencyMs: number;
  jitterFrames: number;
  description: string;
}

export interface CodecProfile {
  id: CodecProfileId;
  label: string;
  bitrateKbps: number;
  transport: 'webrtc' | 'websocket';
  sampleRate: number;
}

export interface ConnectedReceiverInfo {
  id: string;
  deviceName: string;
  joinedAt: number;
  rttMs: number | null;
  transportMode: 'webrtc' | 'websocket' | 'connecting';
}

export interface StreamMetadata {
  active: boolean;
  source: AudioSourceType;
  sourceLabel: string;
  codec: CodecProfileId;
  latencyPreset: LatencyPresetId;
  sampleRate: number;
  channels: number;
  muted: boolean;
}

export interface DecodedAudioPacket {
  seq: number;
  timestampMs: number;
  sampleRate: number;
  channels: number;
  samples: Float32Array;
}

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export const PACKET_MAGIC = 0x5742;
export const PACKET_HEADER_BYTES = 16;

export const LATENCY_PRESETS: Record<LatencyPresetId, LatencyPreset> = {
  ultra: {
    id: 'ultra',
    label: 'Ultra-baja',
    targetLatencyMs: 15,
    jitterFrames: 1,
    description: 'Mínimo retardo para video y juegos en Wi-Fi 5 GHz estable',
  },
  balanced: {
    id: 'balanced',
    label: 'Equilibrada',
    targetLatencyMs: 40,
    jitterFrames: 2,
    description: 'Balance óptimo para música, YouTube y streaming continuo',
  },
  stable: {
    id: 'stable',
    label: 'Estable',
    targetLatencyMs: 80,
    jitterFrames: 4,
    description: 'Buffer amplio contra microcortes en redes Wi-Fi saturadas',
  },
};

export const CODEC_PROFILES: Record<CodecProfileId, CodecProfile> = {
  'opus-256': {
    id: 'opus-256',
    label: 'Opus 256 kbps (WebRTC)',
    bitrateKbps: 256,
    transport: 'webrtc',
    sampleRate: 48000,
  },
  'opus-128': {
    id: 'opus-128',
    label: 'Opus 128 kbps (WebRTC)',
    bitrateKbps: 128,
    transport: 'webrtc',
    sampleRate: 48000,
  },
  'pcm-raw': {
    id: 'pcm-raw',
    label: 'PCM Sin Compresión (WS)',
    bitrateKbps: 1536,
    transport: 'websocket',
    sampleRate: 48000,
  },
};

export function generateRoomCode(randomFn: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(randomFn() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[Math.min(idx, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function formatRoomCode(code: string): string {
  const clean = normalizeRoomCode(code);
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

export function isValidRoomCode(input: string): boolean {
  const clean = normalizeRoomCode(input);
  if (clean.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of clean) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function buildReceiverUrl(origin: string, roomCode: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const cleanCode = normalizeRoomCode(roomCode);
  return `${cleanOrigin}/?mode=receiver&room=${encodeURIComponent(cleanCode)}`;
}

/**
 * Encodes Float32 PCM samples (-1.0..1.0) into a compact 16-bit PCM binary packet
 * with a 16-byte header for ultra-low-latency WebSocket audio relay.
 */
export function encodeAudioPacket(
  samples: Float32Array,
  seq: number,
  timestampMs: number,
  sampleRate: number,
  channels: number
): ArrayBuffer {
  const byteLength = PACKET_HEADER_BYTES + samples.length * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  view.setUint16(0, PACKET_MAGIC, true);
  view.setUint32(2, seq >>> 0, true);
  view.setUint32(6, Math.round(timestampMs) >>> 0, true);
  view.setUint32(10, sampleRate >>> 0, true);
  view.setUint8(14, channels & 0xff);
  view.setUint8(15, 0);

  let offset = PACKET_HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

export function decodeAudioPacket(buffer: ArrayBuffer): DecodedAudioPacket | null {
  if (buffer.byteLength < PACKET_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  const magic = view.getUint16(0, true);
  if (magic !== PACKET_MAGIC) return null;

  const seq = view.getUint32(2, true);
  const timestampMs = view.getUint32(6, true);
  const sampleRate = view.getUint32(10, true);
  const channels = view.getUint8(14);
  if (sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8) {
    return null;
  }

  const sampleCount = Math.floor((buffer.byteLength - PACKET_HEADER_BYTES) / 2);
  const samples = new Float32Array(sampleCount);
  let offset = PACKET_HEADER_BYTES;
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(offset, true);
    samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
    offset += 2;
  }

  return {
    seq,
    timestampMs,
    sampleRate,
    channels,
    samples,
  };
}

export function computeJitterStats(rttHistoryMs: number[], receivedSeqs: number[]): {
  avgRttMs: number | null;
  jitterMs: number;
  packetLossPct: number;
} {
  const validRtts = rttHistoryMs.filter((v) => Number.isFinite(v) && v >= 0);
  const avgRttMs =
    validRtts.length > 0
      ? Math.round(validRtts.reduce((sum, v) => sum + v, 0) / validRtts.length)
      : null;

  let jitterMs = 0;
  if (validRtts.length >= 2) {
    let diffSum = 0;
    for (let i = 1; i < validRtts.length; i++) {
      diffSum += Math.abs(validRtts[i] - validRtts[i - 1]);
    }
    jitterMs = Math.round((diffSum / (validRtts.length - 1)) * 10) / 10;
  }

  let packetLossPct = 0;
  if (receivedSeqs.length >= 2) {
    const minSeq = Math.min(...receivedSeqs);
    const maxSeq = Math.max(...receivedSeqs);
    const expected = maxSeq - minSeq + 1;
    if (expected > 0) {
      const uniqueCount = new Set(receivedSeqs).size;
      const lost = Math.max(0, expected - uniqueCount);
      packetLossPct = Math.round((lost / expected) * 1000) / 10;
    }
  }

  return { avgRttMs, jitterMs, packetLossPct };
}
