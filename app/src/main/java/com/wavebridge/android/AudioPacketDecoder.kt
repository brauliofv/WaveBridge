package com.wavebridge.android

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class DecodedPcmFrame(
    val seq: Long,
    val timestampMs: Long,
    val sampleRate: Int,
    val channels: Int,
    val pcmBytes: ByteArray
)

object AudioPacketDecoder {
    private const val PACKET_MAGIC = 0x5742
    private const val HEADER_BYTES = 16

    fun decode(raw: ByteArray): DecodedPcmFrame? {
        if (raw.size <= HEADER_BYTES) return null

        val header = ByteBuffer.wrap(raw, 0, HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        val magic = header.short.toInt() and 0xFFFF
        if (magic != PACKET_MAGIC) return null

        val seq = header.int.toLong() and 0xFFFFFFFFL
        val timestampMs = header.int.toLong() and 0xFFFFFFFFL
        val sampleRate = header.int
        val channels = header.get().toInt() and 0xFF
        header.get() // reserved byte

        if (sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8) {
            return null
        }

        val pcmLength = raw.size - HEADER_BYTES
        val pcmBytes = ByteArray(pcmLength)
        System.arraycopy(raw, HEADER_BYTES, pcmBytes, 0, pcmLength)

        return DecodedPcmFrame(
            seq = seq,
            timestampMs = timestampMs,
            sampleRate = sampleRate,
            channels = channels,
            pcmBytes = pcmBytes
        )
    }

    fun applyGainInPlace(pcmBytes: ByteArray, gain: Float) {
        if (gain == 1.0f) return
        if (gain <= 0.001f) {
            pcmBytes.fill(0)
            return
        }
        val buf = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)
        val sampleCount = pcmBytes.size / 2
        for (i in 0 until sampleCount) {
            val idx = i * 2
            val sample = buf.getShort(idx).toInt()
            val scaled = (sample * gain).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            buf.putShort(idx, scaled.toShort())
        }
    }
}
