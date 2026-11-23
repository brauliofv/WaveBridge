package com.wavebridge.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class AudioBridgeService : Service() {

    companion object {
        const val ACTION_CONNECT = "com.wavebridge.android.ACTION_CONNECT"
        const val ACTION_DISCONNECT = "com.wavebridge.android.ACTION_DISCONNECT"
        const val ACTION_SET_VOLUME = "com.wavebridge.android.ACTION_SET_VOLUME"
        const val ACTION_STATE_UPDATE = "com.wavebridge.android.ACTION_STATE_UPDATE"

        const val EXTRA_SERVER_URL = "extra_server_url"
        const val EXTRA_ROOM_CODE = "extra_room_code"
        const val EXTRA_VOLUME = "extra_volume"
        const val EXTRA_MUTED = "extra_muted"

        const val EXTRA_IS_CONNECTED = "extra_is_connected"
        const val EXTRA_SENDER_CONNECTED = "extra_sender_connected"
        const val EXTRA_STATUS_TEXT = "extra_status_text"
        const val EXTRA_RTT_MS = "extra_rtt_ms"
        const val EXTRA_PACKETS = "extra_packets"

        private const val CHANNEL_ID = "wavebridge_playback"
        private const val NOTIF_ID = 1042

        @Volatile
        var currentIsConnected = false
            private set

        @Volatile
        var currentRoomCode = ""
            private set

        private val errorHistory = ArrayDeque<String>()

        fun recordError(message: String) {
            synchronized(errorHistory) {
                val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
                    .format(java.util.Date())
                errorHistory.addLast("[$ts] $message")
                while (errorHistory.size > 15) {
                    errorHistory.removeFirst()
                }
            }
        }

        fun getErrorHistory(): List<String> = synchronized(errorHistory) {
            errorHistory.toList()
        }
    }

    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var audioTrack: AudioTrack? = null
    private var currentSampleRate = 48000
    private var currentChannels = 2
    private var wakeLock: PowerManager.WakeLock? = null

    private val audioExecutor = Executors.newSingleThreadExecutor()
    private var pingScheduler: ScheduledExecutorService? = null

    private val isConnectedFlag = AtomicBoolean(false)
    private val senderConnectedFlag = AtomicBoolean(false)
    private val packetsCounter = AtomicLong(0L)

    @Volatile
    private var lastRttMs: Long = -1L

    @Volatile
    private var currentVolume = 1.0f

    @Volatile
    private var isMuted = false

    @Volatile
    private var statusText = "Desconectado"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL) ?: return START_NOT_STICKY
                val roomCode = intent.getStringExtra(EXTRA_ROOM_CODE) ?: return START_NOT_STICKY
                startForeground(NOTIF_ID, buildNotification("Conectando a sala $roomCode..."))
                connectToRoom(serverUrl, roomCode)
            }
            ACTION_SET_VOLUME -> {
                if (intent.hasExtra(EXTRA_VOLUME)) {
                    currentVolume = intent.getFloatExtra(EXTRA_VOLUME, 1.0f).coerceIn(0f, 1.5f)
                }
                if (intent.hasExtra(EXTRA_MUTED)) {
                    isMuted = intent.getBooleanExtra(EXTRA_MUTED, false)
                }
            }
            ACTION_DISCONNECT -> {
                disconnectAndStop()
            }
        }
        return START_NOT_STICKY
    }

    private fun connectToRoom(rawServerUrl: String, roomCode: String) {
        cleanupConnection()
        currentRoomCode = roomCode
        packetsCounter.set(0L)
        lastRttMs = -1L
        statusText = "Conectando a sala $roomCode..."
        broadcastState()

        acquireWakeLock()

        val wsUrl = toWebSocketUrl(rawServerUrl)
        val request = Request.Builder().url(wsUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                isConnectedFlag.set(true)
                currentIsConnected = true
                statusText = "En sala $roomCode · Esperando al emisor"
                updateNotification("Conectado · Sala $roomCode")

                val joinPayload = JSONObject().apply {
                    put("type", "join")
                    put("room", roomCode)
                    put("role", "receiver")
                    put("deviceName", Build.MODEL ?: "Smartphone Android")
                }
                ws.send(joinPayload.toString())

                val transportPayload = JSONObject().apply {
                    put("type", "transport-status")
                    put("mode", "websocket")
                }
                ws.send(transportPayload.toString())

                startPingLoop(ws)
                broadcastState()
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "room-presence" -> {
                            val senderOn = json.optBoolean("senderConnected", false)
                            senderConnectedFlag.set(senderOn)
                            val senderName = json.optString("senderDeviceName", "Navegador PC")
                            statusText = if (senderOn) {
                                "Enlazado con $senderName"
                            } else {
                                "Esperando al emisor en $roomCode"
                            }
                            updateNotification(statusText)
                            broadcastState()
                        }
                        "sender-left" -> {
                            senderConnectedFlag.set(false)
                            statusText = "Emisor desconectado · Esperando"
                            broadcastState()
                        }
                        "pong" -> {
                            val sentTime = json.optDouble("clientTime", -1.0)
                            if (sentTime > 0) {
                                val rtt = (System.nanoTime() / 1_000_000.0 - sentTime).toLong().coerceAtLeast(1L)
                                lastRttMs = rtt
                                val statusMsg = JSONObject().apply {
                                    put("type", "transport-status")
                                    put("mode", "websocket")
                                    put("rttMs", rtt)
                                }
                                ws.send(statusMsg.toString())
                                broadcastState()
                            }
                        }
                        "error" -> {
                            val errMsg = json.optString("message", "Error de conexión")
                            statusText = errMsg
                            recordError("Servidor: $errMsg")
                            broadcastState()
                        }
                    }
                } catch (_: Exception) {
                }
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                val frame = AudioPacketDecoder.decode(bytes.toByteArray()) ?: return
                val count = packetsCounter.incrementAndGet()
                audioExecutor.execute {
                    try {
                        playPcmFrame(frame)
                    } catch (e: Exception) {
                        recordError("AudioTrack: ${e.localizedMessage ?: e.javaClass.simpleName}")
                    }
                }
                if (count % 25L == 0L) {
                    broadcastState()
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                isConnectedFlag.set(false)
                currentIsConnected = false
                senderConnectedFlag.set(false)
                val detail = t.localizedMessage ?: t.javaClass.simpleName
                statusText = "Error de conexión: $detail"
                recordError("WebSocket: $detail")
                broadcastState()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                isConnectedFlag.set(false)
                currentIsConnected = false
                senderConnectedFlag.set(false)
                statusText = "Desconectado"
                broadcastState()
            }
        })
    }

    private fun playPcmFrame(frame: DecodedPcmFrame) {
        val track = ensureAudioTrack(frame.sampleRate, frame.channels) ?: return
        val gain = if (isMuted) 0f else currentVolume
        AudioPacketDecoder.applyGainInPlace(frame.pcmBytes, gain)
        if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
            track.play()
        }
        track.write(frame.pcmBytes, 0, frame.pcmBytes.size, AudioTrack.WRITE_BLOCKING)
    }

    private fun ensureAudioTrack(sampleRate: Int, channels: Int): AudioTrack? {
        if (audioTrack != null && currentSampleRate == sampleRate && currentChannels == channels) {
            return audioTrack
        }
        audioTrack?.release()
        currentSampleRate = sampleRate
        currentChannels = channels

        val channelMask = if (channels == 1) {
            AudioFormat.CHANNEL_OUT_MONO
        } else {
            AudioFormat.CHANNEL_OUT_STEREO
        }

        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            channelMask,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(4096)

        val builder = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelMask)
                    .build()
            )
            .setBufferSizeInBytes(minBuf)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)

        val track = builder.build()
        audioTrack = track
        return track
    }

    private fun startPingLoop(ws: WebSocket) {
        pingScheduler?.shutdownNow()
        val scheduler = Executors.newSingleThreadScheduledExecutor()
        pingScheduler = scheduler
        scheduler.scheduleAtFixedRate({
            try {
                val ping = JSONObject().apply {
                    put("type", "ping")
                    put("clientTime", System.nanoTime() / 1_000_000.0)
                }
                ws.send(ping.toString())
            } catch (_: Exception) {
            }
        }, 1, 2, TimeUnit.SECONDS)
    }

    private fun toWebSocketUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        val wsBase = when {
            trimmed.startsWith("wss://") || trimmed.startsWith("ws://") -> trimmed
            trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
            trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
            else -> "ws://$trimmed"
        }
        return if (wsBase.endsWith("/ws")) wsBase else "$wsBase/ws"
    }

    private fun broadcastState() {
        val intent = Intent(ACTION_STATE_UPDATE).apply {
            setPackage(packageName)
            putExtra(EXTRA_IS_CONNECTED, isConnectedFlag.get())
            putExtra(EXTRA_SENDER_CONNECTED, senderConnectedFlag.get())
            putExtra(EXTRA_STATUS_TEXT, statusText)
            putExtra(EXTRA_RTT_MS, lastRttMs)
            putExtra(EXTRA_PACKETS, packetsCounter.get())
        }
        sendBroadcast(intent)
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WaveBridge::AudioStreamLock").apply {
            acquire(4 * 60 * 60 * 1000L)
        }
    }

    private fun cleanupConnection() {
        pingScheduler?.shutdownNow()
        pingScheduler = null
        webSocket?.close(1000, "Desconectado por el usuario")
        webSocket = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        isConnectedFlag.set(false)
        currentIsConnected = false
        senderConnectedFlag.set(false)
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        wakeLock = null
    }

    private fun disconnectAndStop() {
        cleanupConnection()
        statusText = "Desconectado"
        broadcastState()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "WaveBridge Audio Streaming",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, AudioBridgeService::class.java).apply { action = ACTION_DISCONNECT },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_wavebridge)
            .setContentTitle("WaveBridge Wi-Fi Audio")
            .setContentText(text)
            .setContentIntent(openIntent)
            .addAction(0, "Desconectar", stopIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIF_ID, buildNotification(text))
    }

    override fun onDestroy() {
        cleanupConnection()
        audioExecutor.shutdownNow()
        super.onDestroy()
    }
}
