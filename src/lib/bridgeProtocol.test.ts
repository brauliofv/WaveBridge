import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceiverUrl,
  computeJitterStats,
  decodeAudioPacket,
  encodeAudioPacket,
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
} from './bridgeProtocol';

test('room code generation, normalization, formatting, and validation', () => {
  const code = generateRoomCode(() => 0.25);
  assert.equal(code.length, 6);
  assert.equal(isValidRoomCode(code), true);
  for (const ch of code) {
    assert.equal(ROOM_CODE_ALPHABET.includes(ch), true);
  }

  assert.equal(normalizeRoomCode(' ab-3 9 k '), 'AB39K');
  assert.equal(formatRoomCode('wvb492'), 'WVB-492');
  assert.equal(isValidRoomCode('WVB-492'), true);
  assert.equal(isValidRoomCode('ABC-01I'), false); // 0, 1, I are excluded ambiguous chars
  assert.equal(isValidRoomCode('SHORT'), false);
});

test('buildReceiverUrl formats origin and normalized room code cleanly', () => {
  assert.equal(
    buildReceiverUrl('https://bridge.example.com/', 'wvb-492'),
    'https://bridge.example.com/?mode=receiver&room=WVB492'
  );
});

test('encodeAudioPacket and decodeAudioPacket preserve header metadata and PCM samples', () => {
  const input = new Float32Array([0, 0.5, -0.5, 1.0, -1.0, 0.25]);
  const buf = encodeAudioPacket(input, 42, 123456, 48000, 2);
  const decoded = decodeAudioPacket(buf);

  assert.ok(decoded !== null);
  assert.equal(decoded.seq, 42);
  assert.equal(decoded.timestampMs, 123456);
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.samples.length, input.length);

  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(decoded.samples[i] - input[i]) < 0.001);
  }
});

test('decodeAudioPacket rejects invalid magic bytes or truncated packets', () => {
  const bad = new ArrayBuffer(8);
  assert.equal(decodeAudioPacket(bad), null);

  const wrongMagic = new ArrayBuffer(20);
  new DataView(wrongMagic).setUint16(0, 0x1234, true);
  assert.equal(decodeAudioPacket(wrongMagic), null);
});

test('computeJitterStats computes RTT average, jitter, and packet loss accurately', () => {
  const stats = computeJitterStats([12, 16, 14, 18], [10, 11, 13, 14]);
  assert.equal(stats.avgRttMs, 15);
  assert.equal(stats.jitterMs, 3.3);
  assert.equal(stats.packetLossPct, 20); // seq 12 missing out of 10..14 (5 expected, 4 received)
});
