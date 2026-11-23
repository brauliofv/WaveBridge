package com.wavebridge.android

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Embedded HTTP + RFC 6455 WebSocket server running inside the Android app
 * so the Chrome Extension on the laptop can stream PCM audio directly over
 * local Wi-Fi without running any external terminal script.
 */
class LocalAudioServer(
    private val port: Int = DEFAULT_PORT,
    private val roomCodeProvider: () -> String,
    private val deviceNameProvider: () -> String,
    private val onSenderConnected: (senderName: String) -> Unit,
    private val onSenderDisconnected: () -> Unit,
    private val onPcmFrame: (DecodedPcmFrame) -> Unit,
    private val onError: (String) -> Unit
) {

    companion object {
        const val DEFAULT_PORT = 8765
        private const val WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val MAX_FRAME_BYTES = 2 * 1024 * 1024
    }

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptExecutor: ExecutorService? = null
    private var clientExecutor: ExecutorService? = null

    @Volatile
    private var activeSenderSocket: Socket? = null

    fun start(): Boolean {
        if (running.get()) return true
        return try {
            val ss = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress("0.0.0.0", port))
            }
            serverSocket = ss
            running.set(true)
            acceptExecutor = Executors.newSingleThreadExecutor()
            clientExecutor = Executors.newCachedThreadPool()
            acceptExecutor?.execute { acceptLoop(ss) }
            true
        } catch (e: Exception) {
            onError("Servidor local :$port falló: ${e.localizedMessage ?: e.javaClass.simpleName}")
            stop()
            false
        }
    }

    fun stop() {
        running.set(false)
        try {
            activeSenderSocket?.close()
        } catch (_: Exception) {
        }
        activeSenderSocket = null
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        acceptExecutor?.shutdownNow()
        acceptExecutor = null
        clientExecutor?.shutdownNow()
        clientExecutor = null
    }

    private fun acceptLoop(ss: ServerSocket) {
        while (running.get() && !ss.isClosed) {
            try {
                val client = ss.accept()
                client.tcpNoDelay = true
                clientExecutor?.execute { handleClient(client) }
            } catch (_: SocketException) {
                break
            } catch (e: Exception) {
                if (running.get()) {
                    onError("Accept :$port: ${e.localizedMessage ?: e.javaClass.simpleName}")
                }
            }
        }
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.soTimeout = 5000
            val input = BufferedInputStream(socket.getInputStream(), 65536)
            val output = socket.getOutputStream()

            val headerText = readHttpHeaders(input) ?: return
            val lines = headerText.split("\r\n")
            if (lines.isEmpty()) return

            val requestParts = lines[0].split(" ")
            val method = requestParts.getOrNull(0)?.uppercase() ?: "GET"
            val rawPath = requestParts.getOrNull(1) ?: "/"
            val path = rawPath.substringBefore("?")

            val headers = mutableMapOf<String, String>()
            for (i in 1 until lines.size) {
                val line = lines[i]
                val colon = line.indexOf(':')
                if (colon > 0) {
                    headers[line.substring(0, colon).trim().lowercase()] =
                        line.substring(colon + 1).trim()
                }
            }

            if (method == "OPTIONS") {
                val reqHeaders = headers["access-control-request-headers"]
                writeHttpResponse(
                    output,
                    200,
                    "OK",
                    "text/plain",
                    ByteArray(0),
                    reqHeaders
                )
                return
            }

            if (path == "/ws" && headers["upgrade"]?.lowercase() == "websocket") {
                val wsKey = headers["sec-websocket-key"]
                if (!wsKey.isNullOrBlank()) {
                    socket.soTimeout = 0
                    handleWebSocket(socket, input, output, wsKey)
                    return
                }
            }

            if (path == "/api/health") {
                val json = JSONObject().apply {
                    put("ok", true)
                    put("service", "wavebridge-android")
                    put("port", port)
                    put("deviceName", deviceNameProvider())
                    put("roomCode", roomCodeProvider())
                }
                writeHttpResponse(
                    output,
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    json.toString().toByteArray(Charsets.UTF_8)
                )
            } else {
                val html = """
                    <!doctype html><html lang="es"><head><meta charset="utf-8">
                    <title>WaveBridge Receptor Android</title></head>
                    <body style="font-family:sans-serif;background:#0b0d10;color:#f4f5f7;padding:24px">
                    <h2>WaveBridge Receptor Android activo</h2>
                    <p>Conecta la extensión de Chrome a esta IP en tu Wi-Fi local.</p>
                    </body></html>
                """.trimIndent().toByteArray(Charsets.UTF_8)
                writeHttpResponse(output, 200, "OK", "text/html; charset=utf-8", html)
            }
        } catch (_: Exception) {
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun handleWebSocket(
        socket: Socket,
        input: BufferedInputStream,
        output: OutputStream,
        wsKey: String
    ) {
        val acceptBytes = MessageDigest.getInstance("SHA-1")
            .digest((wsKey + WS_GUID).toByteArray(Charsets.US_ASCII))
        val acceptHash = Base64.encodeToString(acceptBytes, Base64.NO_WRAP)

        val handshake = (
            "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: $acceptHash\r\n\r\n"
            ).toByteArray(Charsets.US_ASCII)
        synchronized(output) {
            output.write(handshake)
            output.flush()
        }

        var joinedAsSender = false
        var fragOpcode = -1
        val fragBuffer = ArrayList<Byte>()

        try {
            while (running.get() && !socket.isClosed) {
                val frame = readWsFrame(input) ?: break
                val (fin, opcode, payload) = frame

                when (opcode) {
                    0x8 -> { // Close
                        sendWsFrame(output, 0x8, ByteArray(0))
                        break
                    }
                    0x9 -> { // Ping -> Pong
                        sendWsFrame(output, 0xA, payload)
                        continue
                    }
                    0xA -> continue // Pong
                    0x1, 0x2 -> {
                        if (fin) {
                            if (opcode == 0x1) {
                                val text = String(payload, Charsets.UTF_8)
                                if (handleJsonMessage(socket, output, text, joinedAsSender)) {
                                    joinedAsSender = true
                                }
                            } else if (joinedAsSender) {
                                val decoded = AudioPacketDecoder.decode(payload)
                                if (decoded != null) {
                                    onPcmFrame(decoded)
                                }
                            }
                        } else {
                            fragOpcode = opcode
                            fragBuffer.clear()
                            for (b in payload) fragBuffer.add(b)
                        }
                    }
                    0x0 -> {
                        if (fragOpcode != -1) {
                            for (b in payload) fragBuffer.add(b)
                            if (fin) {
                                val full = fragBuffer.toByteArray()
                                val curOpcode = fragOpcode
                                fragOpcode = -1
                                fragBuffer.clear()
                                if (curOpcode == 0x1) {
                                    val text = String(full, Charsets.UTF_8)
                                    if (handleJsonMessage(socket, output, text, joinedAsSender)) {
                                        joinedAsSender = true
                                    }
                                } else if (joinedAsSender) {
                                    val decoded = AudioPacketDecoder.decode(full)
                                    if (decoded != null) {
                                        onPcmFrame(decoded)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } finally {
            if (joinedAsSender) {
                if (activeSenderSocket === socket) {
                    activeSenderSocket = null
                    onSenderDisconnected()
                }
            }
        }
    }

    private fun handleJsonMessage(
        socket: Socket,
        output: OutputStream,
        rawText: String,
        alreadyJoined: Boolean
    ): Boolean {
        return try {
            val json = JSONObject(rawText)
            when (json.optString("type")) {
                "join" -> {
                    val requestedRoom = json.optString("room", "")
                        .uppercase()
                        .replace(Regex("[^A-Z0-9]"), "")
                    val expectedRoom = roomCodeProvider()
                    if (expectedRoom.isNotEmpty() && requestedRoom != expectedRoom) {
                        val errJson = JSONObject().apply {
                            put("type", "error")
                            put("message", "Código de sala incorrecto. En tu Android la sala actual es $expectedRoom.")
                        }
                        sendWsText(output, errJson.toString())
                        sendWsFrame(output, 0x8, ByteArray(0))
                        return false
                    }

                    val previous = activeSenderSocket
                    if (previous != null && previous !== socket) {
                        try {
                            previous.close()
                        } catch (_: Exception) {
                        }
                    }
                    activeSenderSocket = socket
                    val senderName = json.optString("deviceName", "Chrome Wi-Fi")

                    sendWsText(
                        output,
                        JSONObject().apply {
                            put("type", "joined")
                            put("peerId", "chrome-sender")
                            put("room", expectedRoom)
                            put("role", "sender")
                        }.toString()
                    )

                    // Tell Chrome extension that Android is ready to receive binary WebSocket PCM
                    val receiversArray = JSONArray().apply {
                        put(
                            JSONObject().apply {
                                put("id", "android-local")
                                put("deviceName", deviceNameProvider())
                                put("transportMode", "websocket")
                                put("rttMs", 2)
                            }
                        )
                    }
                    sendWsText(
                        output,
                        JSONObject().apply {
                            put("type", "room-presence")
                            put("room", expectedRoom)
                            put("senderConnected", true)
                            put("receivers", receiversArray)
                        }.toString()
                    )

                    onSenderConnected(senderName)
                    true
                }
                "stream-state" -> {
                    if (alreadyJoined) {
                        val state = json.optJSONObject("state")
                        val label = state?.optString("sourceLabel", "Chrome Wi-Fi") ?: "Chrome Wi-Fi"
                        onSenderConnected(label)
                    }
                    alreadyJoined
                }
                "ping" -> {
                    sendWsText(
                        output,
                        JSONObject().apply {
                            put("type", "pong")
                            put("clientTime", json.optDouble("clientTime", 0.0))
                            put("serverTime", System.currentTimeMillis())
                        }.toString()
                    )
                    alreadyJoined
                }
                else -> alreadyJoined
            }
        } catch (_: Exception) {
            alreadyJoined
        }
    }

    private fun readHttpHeaders(input: InputStream): String? {
        val sb = StringBuilder()
        var lastFour = 0
        while (sb.length < 16384) {
            val b = input.read()
            if (b == -1) return null
            sb.append(b.toChar())
            lastFour = ((lastFour shl 8) or (b and 0xFF))
            if (lastFour == 0x0D0A0D0A) {
                return sb.toString()
            }
        }
        return null
    }

    private fun writeHttpResponse(
        output: OutputStream,
        status: Int,
        reason: String,
        contentType: String,
        body: ByteArray,
        extraAllowHeaders: String? = null
    ) {
        val allowHeaders = extraAllowHeaders?.takeIf { it.isNotBlank() } ?: "Content-Type"
        val headers = (
            "HTTP/1.1 $status $reason\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n" +
                "Access-Control-Allow-Headers: $allowHeaders\r\n" +
                "Access-Control-Allow-Private-Network: true\r\n" +
                "Access-Control-Max-Age: 600\r\n" +
                "Connection: close\r\n\r\n"
            ).toByteArray(Charsets.US_ASCII)
        output.write(headers)
        if (body.isNotEmpty()) {
            output.write(body)
        }
        output.flush()
    }

    private fun readWsFrame(input: InputStream): Triple<Boolean, Int, ByteArray>? {
        val h = ByteArray(2)
        if (!readFully(input, h, 2)) return null
        val b1 = h[0].toInt() and 0xFF
        val b2 = h[1].toInt() and 0xFF
        val fin = (b1 and 0x80) != 0
        val opcode = b1 and 0x0F
        val masked = (b2 and 0x80) != 0
        var length = (b2 and 0x7F).toLong()

        if (length == 126L) {
            val ext = ByteArray(2)
            if (!readFully(input, ext, 2)) return null
            length = (((ext[0].toInt() and 0xFF) shl 8) or (ext[1].toInt() and 0xFF)).toLong()
        } else if (length == 127L) {
            val ext = ByteArray(8)
            if (!readFully(input, ext, 8)) return null
            length = 0L
            for (i in 0 until 8) {
                length = (length shl 8) or (ext[i].toLong() and 0xFF)
            }
        }

        if (length < 0 || length > MAX_FRAME_BYTES) return null
        val lenInt = length.toInt()
        val mask = if (masked) {
            val m = ByteArray(4)
            if (!readFully(input, m, 4)) return null
            m
        } else {
            null
        }

        val payload = ByteArray(lenInt)
        if (lenInt > 0 && !readFully(input, payload, lenInt)) return null

        if (mask != null) {
            for (i in 0 until lenInt) {
                payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
            }
        }
        return Triple(fin, opcode, payload)
    }

    private fun readFully(input: InputStream, dst: ByteArray, len: Int): Boolean {
        var offset = 0
        while (offset < len) {
            val read = input.read(dst, offset, len - offset)
            if (read == -1) return false
            offset += read
        }
        return true
    }

    private fun sendWsText(output: OutputStream, text: String) {
        sendWsFrame(output, 0x1, text.toByteArray(Charsets.UTF_8))
    }

    private fun sendWsFrame(output: OutputStream, opcode: Int, payload: ByteArray) {
        val len = payload.size
        val header = when {
            len < 126 -> byteArrayOf((0x80 or (opcode and 0x0F)).toByte(), len.toByte())
            len < 65536 -> byteArrayOf(
                (0x80 or (opcode and 0x0F)).toByte(),
                126.toByte(),
                ((len ushr 8) and 0xFF).toByte(),
                (len and 0xFF).toByte()
            )
            else -> byteArrayOf(
                (0x80 or (opcode and 0x0F)).toByte(),
                127.toByte(),
                0, 0, 0, 0,
                ((len ushr 24) and 0xFF).toByte(),
                ((len ushr 16) and 0xFF).toByte(),
                ((len ushr 8) and 0xFF).toByte(),
                (len and 0xFF).toByte()
            )
        }
        try {
            synchronized(output) {
                output.write(header)
                if (len > 0) {
                    output.write(payload)
                }
                output.flush()
            }
        } catch (_: Exception) {
        }
    }
}
