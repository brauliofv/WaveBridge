const PACKET_HEADER_BYTES = 16;
const TARGET_FRAMES = 256; // 5.33 ms @ 48 kHz (2 WebAudio quanta)

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
    if (!input || input.length === 0) {
      return true;
    }
    const left = input[0];
    if (!left || left.length === 0) {
      return true;
    }
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

registerProcessor('wavebridge-pcm-processor', WaveBridgePcmProcessor);
