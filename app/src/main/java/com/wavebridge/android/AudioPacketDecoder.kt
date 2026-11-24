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
        val kneeStart = 28000f
        val maxVal = Short.MAX_VALUE.toFloat()
        val headRoom = maxVal - kneeStart

        for (i in 0 until sampleCount) {
            val idx = i * 2
            val raw = buf.getShort(idx) * gain
            val absVal = if (raw < 0f) -raw else raw
            val out = if (gain > 1.0f && absVal > kneeStart) {
                val excess = absVal - kneeStart
                val compressed = kneeStart + (headRoom * excess) / (headRoom + excess)
                if (raw < 0f) -compressed else compressed
            } else {
                raw
            }
            val clamped = out.toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            buf.putShort(idx, clamped.toShort())
        }
    }

    /**
     * Applies a fast ~2 ms linear fade-in from the previous boundary sample to eliminate
     * sudden waveform step discontinuities (audible clicks/interference) when recovering
     * from a Wi-Fi micro-underrun or queue resynchronization.
     */
    fun applySmoothSplice(
        pcmBytes: ByteArray,
        sampleRate: Int,
        channels: Int,
        prevLeft: Short = 0,
        prevRight: Short = 0
    ): Pair<Short, Short> {
        val totalFrames = pcmBytes.size / (channels * 2)
        if (totalFrames <= 0) return prevLeft to prevRight

        val buf = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)
        val spliceFrames = ((sampleRate * 2) / 1000).coerceIn(16, totalFrames)

        for (f in 0 until spliceFrames) {
            val t = (f + 1).toFloat() / spliceFrames.toFloat()
            val base = f * channels * 2
            val curL = buf.getShort(base).toInt()
            val blendedL = (prevLeft * (1f - t) + curL * t).toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            buf.putShort(base, blendedL.toShort())

            if (channels > 1) {
                val curR = buf.getShort(base + 2).toInt()
                val blendedR = (prevRight * (1f - t) + curR * t).toInt()
                    .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                buf.putShort(base + 2, blendedR.toShort())
            }
        }

        val lastBase = (totalFrames - 1) * channels * 2
        val endL = buf.getShort(lastBase)
        val endR = if (channels > 1) buf.getShort(lastBase + 2) else endL
        return endL to endR
    }

    fun readLastFrameSamples(pcmBytes: ByteArray, channels: Int): Pair<Short, Short> {
        val totalFrames = pcmBytes.size / (channels * 2)
        if (totalFrames <= 0) return 0.toShort() to 0.toShort()
        val buf = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)
        val lastBase = (totalFrames - 1) * channels * 2
        val endL = buf.getShort(lastBase)
        val endR = if (channels > 1) buf.getShort(lastBase + 2) else endL
        return endL to endR
    }
}
