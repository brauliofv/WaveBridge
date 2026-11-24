package com.wavebridge.android

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var btnModeDirect: MaterialButton
    private lateinit var btnModeBridge: MaterialButton
    private lateinit var layoutDirectInfo: LinearLayout
    private lateinit var layoutBridgeSettings: LinearLayout
    private lateinit var tvPhoneIp: TextView
    private lateinit var etRoomCode: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnScanLan: MaterialButton
    private lateinit var btnConnect: MaterialButton
    private lateinit var btnMute: MaterialButton
    private lateinit var btnDiagnostics: MaterialButton
    private lateinit var cardTelemetry: MaterialCardView
    private lateinit var tvStateBadge: TextView
    private lateinit var tvBluetoothBadge: TextView
    private lateinit var tvBluetoothOutput: TextView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var tvStatNet: TextView
    private lateinit var tvStatBuffer: TextView
    private lateinit var tvStatPackets: TextView
    private lateinit var btnProfileUltra: MaterialButton
    private lateinit var btnProfileBalanced: MaterialButton
    private lateinit var btnProfileStable: MaterialButton
    private lateinit var tvProfileHint: TextView
    private lateinit var tvAppVersion: TextView
    private lateinit var seekVolume: SeekBar

    private val prefs by lazy { getSharedPreferences("wavebridge_prefs", Context.MODE_PRIVATE) }
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var scanJob: Job? = null

    private lateinit var audioManager: AudioManager
    private var isMuted = false
    private var isConnected = false
    private var isSenderConnected = false
    private var modeDirect = true
    private var latencyProfile = AudioBridgeService.PROFILE_BALANCED

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshBluetoothOutput()
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AudioBridgeService.ACTION_STATE_UPDATE) return
            isConnected = intent.getBooleanExtra(AudioBridgeService.EXTRA_IS_CONNECTED, false)
            isSenderConnected = intent.getBooleanExtra(AudioBridgeService.EXTRA_SENDER_CONNECTED, false)
            val statusText = intent.getStringExtra(AudioBridgeService.EXTRA_STATUS_TEXT) ?: "Desconectado"
            val rttMs = intent.getLongExtra(AudioBridgeService.EXTRA_RTT_MS, -1L)
            val packets = intent.getLongExtra(AudioBridgeService.EXTRA_PACKETS, 0L)
            val bufferMs = intent.getIntExtra(AudioBridgeService.EXTRA_BUFFER_MS, 0)
            val dropped = intent.getLongExtra(AudioBridgeService.EXTRA_DROPPED, 0L)
            intent.getStringExtra(AudioBridgeService.EXTRA_PROFILE)?.let { incomingProfile ->
                if (incomingProfile != latencyProfile) {
                    latencyProfile = normalizeProfile(incomingProfile)
                    applyProfileUi()
                }
            }

            tvConnectionStatus.text = statusText
            renderTelemetry(rttMs, packets, bufferMs, dropped)
            updateConnectButtonUi()
        }
    }

    private val audioDeviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
            refreshBluetoothOutput()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
            refreshBluetoothOutput()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val mainContent = findViewById<LinearLayout>(R.id.mainContent)
        val density = resources.displayMetrics.density
        val padHorizontal = (20 * density).toInt()
        val padTop = (20 * density).toInt()
        val padBottom = (56 * density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(mainContent) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(
                padHorizontal + bars.left,
                padTop + bars.top,
                padHorizontal + bars.right,
                padBottom + bars.bottom
            )
            windowInsets
        }
        ViewCompat.requestApplyInsets(mainContent)

        btnModeDirect = findViewById(R.id.btnModeDirect)
        btnModeBridge = findViewById(R.id.btnModeBridge)
        layoutDirectInfo = findViewById(R.id.layoutDirectInfo)
        layoutBridgeSettings = findViewById(R.id.layoutBridgeSettings)
        tvPhoneIp = findViewById(R.id.tvPhoneIp)
        etRoomCode = findViewById(R.id.etRoomCode)
        etServerUrl = findViewById(R.id.etServerUrl)
        btnScanLan = findViewById(R.id.btnScanLan)
        btnConnect = findViewById(R.id.btnConnect)
        btnMute = findViewById(R.id.btnMute)
        btnDiagnostics = findViewById(R.id.btnDiagnostics)
        cardTelemetry = findViewById(R.id.cardTelemetry)
        tvStateBadge = findViewById(R.id.tvStateBadge)
        tvBluetoothBadge = findViewById(R.id.tvBluetoothBadge)
        tvBluetoothOutput = findViewById(R.id.tvBluetoothOutput)
        tvConnectionStatus = findViewById(R.id.tvConnectionStatus)
        tvStatNet = findViewById(R.id.tvStatNet)
        tvStatBuffer = findViewById(R.id.tvStatBuffer)
        tvStatPackets = findViewById(R.id.tvStatPackets)
        btnProfileUltra = findViewById(R.id.btnProfileUltra)
        btnProfileBalanced = findViewById(R.id.btnProfileBalanced)
        btnProfileStable = findViewById(R.id.btnProfileStable)
        tvProfileHint = findViewById(R.id.tvProfileHint)
        tvAppVersion = findViewById(R.id.tvAppVersion)
        seekVolume = findViewById(R.id.seekVolume)

        tvAppVersion.text = "v${BuildConfig.VERSION_NAME} · ${BuildConfig.BUILD_DATE}"

        modeDirect = prefs.getBoolean("mode_direct", true)
        latencyProfile = normalizeProfile(
            prefs.getString("latency_profile", AudioBridgeService.PROFILE_BALANCED)
        )
        val savedServer = prefs.getString("server_url", null)
        if (!savedServer.isNullOrBlank() &&
            savedServer != "http://192.168.1.50:3000" &&
            isLocalLanUrl(savedServer)
        ) {
            etServerUrl.setText(savedServer)
        }
        val savedRoom = prefs.getString("room_code", null)?.takeIf { it.length == 6 }
            ?: generateRandomRoomCode().also { prefs.edit().putString("room_code", it).apply() }
        etRoomCode.setText(savedRoom)

        audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        requestRequiredPermissions()
        handleIncomingIntent(intent)

        isConnected = AudioBridgeService.currentIsConnected
        isSenderConnected = AudioBridgeService.currentSenderConnected
        if (isConnected) {
            modeDirect = AudioBridgeService.currentDirectMode
            latencyProfile = normalizeProfile(AudioBridgeService.currentProfile)
            if (AudioBridgeService.currentRoomCode.isNotEmpty()) {
                etRoomCode.setText(AudioBridgeService.currentRoomCode)
            }
            tvConnectionStatus.text = AudioBridgeService.currentStatusText
            renderTelemetry(
                AudioBridgeService.currentRttMs,
                AudioBridgeService.currentPackets,
                AudioBridgeService.currentBufferMs,
                AudioBridgeService.currentDropped
            )
        }

        applyModeUi()
        applyProfileUi()
        refreshPhoneIp()
        updateConnectButtonUi()

        // Zero-step convenience: auto-start direct Wi-Fi receiver on launch when in direct mode
        if (modeDirect && !isConnected) {
            startDirectListener(savedRoom)
        }

        btnModeDirect.setOnClickListener {
            if (isConnected) {
                Toast.makeText(this, "Detén el receptor antes de cambiar de modo", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            modeDirect = true
            prefs.edit().putBoolean("mode_direct", true).apply()
            if (isStatusError(tvConnectionStatus.text?.toString().orEmpty())) {
                tvConnectionStatus.text = "Desconectado"
            }
            applyModeUi()
            updateConnectButtonUi()
        }

        btnModeBridge.setOnClickListener {
            if (isConnected) {
                Toast.makeText(this, "Detén el receptor antes de cambiar de modo", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            modeDirect = false
            prefs.edit().putBoolean("mode_direct", false).apply()
            if (isStatusError(tvConnectionStatus.text?.toString().orEmpty())) {
                tvConnectionStatus.text = "Desconectado"
            }
            applyModeUi()
            updateConnectButtonUi()
            if (etServerUrl.text.isNullOrBlank()) {
                scanLocalWifiForBridge(autoConnectRoom = null)
            }
        }

        btnScanLan.setOnClickListener {
            scanLocalWifiForBridge(autoConnectRoom = null)
        }

        btnConnect.setOnClickListener {
            if (isConnected) {
                val stopIntent = Intent(this, AudioBridgeService::class.java).apply {
                    action = AudioBridgeService.ACTION_DISCONNECT
                }
                startService(stopIntent)
            } else {
                val room = etRoomCode.text.toString().uppercase().replace(Regex("[^A-Z0-9]"), "")
                if (room.length != 6) {
                    val msg = "Código inválido: debe tener 6 caracteres"
                    tvConnectionStatus.text = "Ingresa un código válido de 6 caracteres"
                    AudioBridgeService.recordError(msg)
                    updateConnectButtonUi()
                    return@setOnClickListener
                }
                prefs.edit().putString("room_code", room).apply()

                if (modeDirect) {
                    startDirectListener(room)
                } else {
                    val rawServer = etServerUrl.text.toString().trim()
                    if (rawServer.isEmpty()) {
                        scanLocalWifiForBridge(autoConnectRoom = room)
                        return@setOnClickListener
                    }
                    val serverUrl = normalizeBridgeServerUrl(rawServer)
                    if (!isLocalLanUrl(serverUrl)) {
                        val msg = "Usa la IP local Wi-Fi de tu laptop (ej. http://192.168.100.10:3000)"
                        tvConnectionStatus.text = msg
                        AudioBridgeService.recordError(msg)
                        updateConnectButtonUi()
                        return@setOnClickListener
                    }
                    etServerUrl.setText(serverUrl)
                    startBridgeClient(room, serverUrl)
                }
            }
        }

        seekVolume.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                val vol = progress / 100f
                sendVolumeUpdate(vol, isMuted)
            }

            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })

        btnMute.setOnClickListener {
            isMuted = !isMuted
            updateMuteButtonUi()
            sendVolumeUpdate(seekVolume.progress / 100f, isMuted)
        }

        btnProfileUltra.setOnClickListener {
            selectLatencyProfile(AudioBridgeService.PROFILE_ULTRA)
        }
        btnProfileBalanced.setOnClickListener {
            selectLatencyProfile(AudioBridgeService.PROFILE_BALANCED)
        }
        btnProfileStable.setOnClickListener {
            selectLatencyProfile(AudioBridgeService.PROFILE_STABLE)
        }

        btnDiagnostics.setOnClickListener {
            shareDiagnosticReport()
        }
        updateMuteButtonUi()
    }

    private fun normalizeProfile(raw: String?): String {
        return when (raw) {
            AudioBridgeService.PROFILE_ULTRA -> AudioBridgeService.PROFILE_ULTRA
            AudioBridgeService.PROFILE_STABLE -> AudioBridgeService.PROFILE_STABLE
            else -> AudioBridgeService.PROFILE_BALANCED
        }
    }

    private fun selectLatencyProfile(profileId: String) {
        val clean = normalizeProfile(profileId)
        latencyProfile = clean
        prefs.edit().putString("latency_profile", clean).apply()
        applyProfileUi()
        if (isConnected) {
            val profileIntent = Intent(this, AudioBridgeService::class.java).apply {
                action = AudioBridgeService.ACTION_SET_PROFILE
                putExtra(AudioBridgeService.EXTRA_PROFILE, clean)
            }
            startService(profileIntent)
        }
    }

    private fun applyProfileUi() {
        val activeBg = Color.parseColor("#0E2A3A")
        val inactiveBg = Color.parseColor("#0B0D10")
        val activeStroke = Color.parseColor("#0EA5E9")
        val inactiveStroke = Color.parseColor("#2A323D")
        val activeText = Color.parseColor("#F4F5F7")
        val mutedText = Color.parseColor("#9CA3AF")

        val buttons = listOf(
            btnProfileUltra to AudioBridgeService.PROFILE_ULTRA,
            btnProfileBalanced to AudioBridgeService.PROFILE_BALANCED,
            btnProfileStable to AudioBridgeService.PROFILE_STABLE
        )
        for ((btn, id) in buttons) {
            val active = latencyProfile == id
            btn.backgroundTintList = ColorStateList.valueOf(if (active) activeBg else inactiveBg)
            btn.strokeColor = ColorStateList.valueOf(if (active) activeStroke else inactiveStroke)
            btn.setTextColor(if (active) activeText else mutedText)
        }

        tvProfileHint.text = when (latencyProfile) {
            AudioBridgeService.PROFILE_ULTRA ->
                "Ultra (~25 ms): máxima respuesta en Wi-Fi 5 GHz sin obstáculos."
            AudioBridgeService.PROFILE_STABLE ->
                "Estable (~60 ms): absorbe microcortes en Wi-Fi 2.4 GHz o congestionado."
            else ->
                "Equilibrado (~38 ms): baja latencia con filtro suave anti-interferencias."
        }
    }

    private fun startBridgeClient(room: String, serverUrl: String) {
        prefs.edit().putString("server_url", serverUrl).apply()
        val startIntent = Intent(this, AudioBridgeService::class.java).apply {
            action = AudioBridgeService.ACTION_CONNECT
            putExtra(AudioBridgeService.EXTRA_ROOM_CODE, room)
            putExtra(AudioBridgeService.EXTRA_SERVER_URL, serverUrl)
            putExtra(AudioBridgeService.EXTRA_PROFILE, latencyProfile)
        }
        ContextCompat.startForegroundService(this, startIntent)
    }

    private fun normalizeBridgeServerUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return ""
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
        return try {
            val uri = URL(withScheme)
            if (uri.port == -1) "http://${uri.host}:3000" else "http://${uri.host}:${uri.port}"
        } catch (_: Exception) {
            withScheme
        }
    }

    private fun generateRandomRoomCode(): String {
        val chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
        return (1..6).map { chars.random() }.joinToString("")
    }

    private fun startDirectListener(room: String) {
        val ip = findLocalWifiIpv4()
        if (ip == null) {
            val msg = "Conecta este teléfono al Wi-Fi local para recibir el audio."
            tvPhoneIp.text = "Sin conexión Wi-Fi"
            tvConnectionStatus.text = msg
            AudioBridgeService.recordError(msg)
            updateConnectButtonUi()
            return
        }
        tvPhoneIp.text = "$ip:${LocalAudioServer.DEFAULT_PORT}"
        val startIntent = Intent(this, AudioBridgeService::class.java).apply {
            action = AudioBridgeService.ACTION_START_DIRECT
            putExtra(AudioBridgeService.EXTRA_ROOM_CODE, room)
            putExtra(AudioBridgeService.EXTRA_LISTEN_HOST, ip)
            putExtra(AudioBridgeService.EXTRA_PROFILE, latencyProfile)
        }
        try {
            ContextCompat.startForegroundService(this, startIntent)
        } catch (e: Exception) {
            val msg = "No se pudo iniciar el receptor en segundo plano: ${e.localizedMessage ?: e.javaClass.simpleName}"
            tvConnectionStatus.text = msg
            AudioBridgeService.recordError(msg)
            updateConnectButtonUi()
        }
    }

    private fun refreshPhoneIp() {
        val ip = findLocalWifiIpv4()
        tvPhoneIp.text = if (ip != null) {
            "$ip:${LocalAudioServer.DEFAULT_PORT}"
        } else {
            "Conéctate al Wi-Fi local"
        }
    }

    private fun applyModeUi() {
        val activeBg = Color.parseColor("#0E2A3A")
        val inactiveBg = Color.parseColor("#0B0D10")
        val activeColor = Color.parseColor("#0EA5E9")
        val inactiveStroke = Color.parseColor("#2A323D")
        val activeText = Color.parseColor("#F4F5F7")
        val mutedText = Color.parseColor("#9CA3AF")

        if (modeDirect) {
            btnModeDirect.backgroundTintList = ColorStateList.valueOf(activeBg)
            btnModeDirect.strokeColor = ColorStateList.valueOf(activeColor)
            btnModeDirect.setTextColor(activeText)
            btnModeBridge.backgroundTintList = ColorStateList.valueOf(inactiveBg)
            btnModeBridge.strokeColor = ColorStateList.valueOf(inactiveStroke)
            btnModeBridge.setTextColor(mutedText)
            layoutDirectInfo.visibility = View.VISIBLE
            layoutBridgeSettings.visibility = View.GONE
        } else {
            btnModeBridge.backgroundTintList = ColorStateList.valueOf(activeBg)
            btnModeBridge.strokeColor = ColorStateList.valueOf(activeColor)
            btnModeBridge.setTextColor(activeText)
            btnModeDirect.backgroundTintList = ColorStateList.valueOf(inactiveBg)
            btnModeDirect.strokeColor = ColorStateList.valueOf(inactiveStroke)
            btnModeDirect.setTextColor(mutedText)
            layoutDirectInfo.visibility = View.GONE
            layoutBridgeSettings.visibility = View.VISIBLE
        }
    }

    private fun scanLocalWifiForBridge(autoConnectRoom: String?) {
        scanJob?.cancel()
        btnScanLan.isEnabled = false
        btnScanLan.text = "Buscando PC en Wi-Fi..."
        tvConnectionStatus.text = "Escaneando red Wi-Fi local (puerto 3000)..."
        updateConnectButtonUi()

        scanJob = uiScope.launch {
            val foundUrl = withContext(Dispatchers.IO) {
                discoverLocalBridgeOnSubnet()
            }
            btnScanLan.isEnabled = true
            btnScanLan.text = "Buscar PC automáticamente en Wi-Fi"
            if (foundUrl != null) {
                etServerUrl.setText(foundUrl)
                prefs.edit().putString("server_url", foundUrl).apply()
                tvConnectionStatus.text = "Laptop encontrada: $foundUrl"
                updateConnectButtonUi()
                Toast.makeText(this@MainActivity, "PC detectada en $foundUrl", Toast.LENGTH_SHORT).show()
                if (!autoConnectRoom.isNullOrEmpty()) {
                    startBridgeClient(autoConnectRoom, foundUrl)
                }
            } else {
                val msg = "No se encontró el puente en tu Wi-Fi. Verifica 'python3 bridge.py' en la laptop y si usas Linux abre el puerto con 'sudo ufw allow 3000/tcp' o escribe la IP que muestra bridge.py."
                tvConnectionStatus.text = msg
                AudioBridgeService.recordError(msg)
                updateConnectButtonUi()
            }
        }
    }

    private suspend fun discoverLocalBridgeOnSubnet(): String? {
        val localIp = findLocalWifiIpv4() ?: return null
        val dotIndex = localIp.lastIndexOf('.')
        if (dotIndex <= 0) return null
        val prefix = localIp.substring(0, dotIndex)
        val selfOctet = localIp.substring(dotIndex + 1).toIntOrNull()

        val candidates = (1..254).filter { it != selfOctet }.map { "$prefix.$it" }
        for (batch in candidates.chunked(32)) {
            val found = kotlinx.coroutines.coroutineScope {
                batch.map { host ->
                    async(Dispatchers.IO) {
                        val url = "http://$host:3000"
                        if (probeWaveBridgeHealth(url)) url else null
                    }
                }.awaitAll().firstOrNull { it != null }
            }
            if (found != null) return found
        }
        return null
    }

    private fun probeWaveBridgeHealth(baseUrl: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 450
                readTimeout = 500
                requestMethod = "GET"
            }
            if (conn.responseCode != 200) return false
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            body.contains("\"service\":\"wavebridge\"") || body.contains("\"ok\":true")
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    private fun findLocalWifiIpv4(): String? {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            val sorted = interfaces.sortedByDescending { iface ->
                val name = iface.name.lowercase()
                when {
                    name.startsWith("wlan") || name.startsWith("wifi") || name.startsWith("ap") -> 2
                    name.startsWith("eth") -> 1
                    else -> 0
                }
            }
            var fallback: String? = null
            for (iface in sorted) {
                if (!iface.isUp || iface.isLoopback) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (ip.startsWith("169.254.")) continue
                        if (ip.startsWith("192.168.")) return ip
                        if (ip.startsWith("10.") || Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.").containsMatchIn(ip)) {
                            if (fallback == null) fallback = ip
                        }
                    }
                }
            }
            fallback
        } catch (_: Exception) {
            null
        }
    }

    private fun isLocalLanUrl(rawUrl: String): Boolean {
        return try {
            val uri = URL(rawUrl.trim())
            val host = uri.host ?: return false
            uri.protocol == "http" && (
                host.startsWith("192.168.") ||
                    host.startsWith("10.") ||
                    host == "localhost" ||
                    host == "127.0.0.1" ||
                    Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.").containsMatchIn(host)
                )
        } catch (_: Exception) {
            false
        }
    }

    private fun shareDiagnosticReport() {
        val errors = AudioBridgeService.getErrorHistory()
        val phoneIp = findLocalWifiIpv4() ?: "sin Wi-Fi"
        val report = buildString {
            appendLine("=== WaveBridge Android Diagnóstico ===")
            appendLine("App: v${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_DATE})")
            appendLine("Dispositivo: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})")
            appendLine("Modo: ${if (modeDirect) "directo-movil" else "puente-pc"}")
            appendLine("Perfil de audio: $latencyProfile")
            appendLine("IP móvil: $phoneIp:${LocalAudioServer.DEFAULT_PORT}")
            appendLine("Salida: ${tvBluetoothOutput.text}")
            appendLine("Estado: ${tvConnectionStatus.text}")
            appendLine("Telemetría: Red=${tvStatNet.text} · Buffer=${tvStatBuffer.text} · Paquetes=${tvStatPackets.text}")
            appendLine("Sala: ${etRoomCode.text}")
            if (!modeDirect) {
                appendLine("Servidor local (Plan B): ${etServerUrl.text}")
            }
            appendLine()
            if (errors.isEmpty()) {
                appendLine("Errores registrados: ninguno en esta sesión.")
            } else {
                appendLine("Errores registrados (${errors.size}):")
                errors.forEach { appendLine("- $it") }
            }
        }

        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("WaveBridge Diagnóstico", report))
        Toast.makeText(this, "Diagnóstico copiado al portapapeles", Toast.LENGTH_SHORT).show()

        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "WaveBridge Android Diagnóstico v${BuildConfig.VERSION_NAME}")
            putExtra(Intent.EXTRA_TEXT, report)
        }
        startActivity(Intent.createChooser(shareIntent, "Compartir diagnóstico"))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            stateReceiver,
            IntentFilter(AudioBridgeService.ACTION_STATE_UPDATE),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        audioManager.registerAudioDeviceCallback(audioDeviceCallback, null)
        refreshBluetoothOutput()
        refreshPhoneIp()
        syncFromServiceState()
    }

    private fun renderTelemetry(rttMs: Long, packets: Long, bufferMs: Int, dropped: Long) {
        tvStatNet.text = if (rttMs >= 0) "$rttMs ms" else "—"
        tvStatBuffer.text = if (bufferMs > 0) "$bufferMs ms" else "—"
        tvStatPackets.text = if (dropped > 0) "$packets (-$dropped)" else "$packets"
    }

    private fun syncFromServiceState() {
        isConnected = AudioBridgeService.currentIsConnected
        isSenderConnected = AudioBridgeService.currentSenderConnected
        if (isConnected) {
            modeDirect = AudioBridgeService.currentDirectMode
            latencyProfile = normalizeProfile(AudioBridgeService.currentProfile)
            applyModeUi()
            applyProfileUi()
        }
        if (isConnected || AudioBridgeService.currentStatusText != "Desconectado") {
            tvConnectionStatus.text = AudioBridgeService.currentStatusText
        }
        renderTelemetry(
            AudioBridgeService.currentRttMs,
            AudioBridgeService.currentPackets,
            AudioBridgeService.currentBufferMs,
            AudioBridgeService.currentDropped
        )
        updateConnectButtonUi()
    }

    override fun onStop() {
        super.onStop()
        unregisterReceiver(stateReceiver)
        audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
    }

    override fun onDestroy() {
        uiScope.cancel()
        super.onDestroy()
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val data = intent?.data ?: return
        val room = data.getQueryParameter("room")
        if (!room.isNullOrBlank()) {
            etRoomCode.setText(room.uppercase().take(6))
        }
        val server = data.getQueryParameter("server")
        if (!server.isNullOrBlank() && isLocalLanUrl(server)) {
            modeDirect = false
            prefs.edit().putBoolean("mode_direct", false).apply()
            etServerUrl.setText(server.trim())
            applyModeUi()
        }
    }

    private fun sendVolumeUpdate(volume: Float, muted: Boolean) {
        val intent = Intent(this, AudioBridgeService::class.java).apply {
            action = AudioBridgeService.ACTION_SET_VOLUME
            putExtra(AudioBridgeService.EXTRA_VOLUME, volume)
            putExtra(AudioBridgeService.EXTRA_MUTED, muted)
        }
        startService(intent)
    }

    private fun updateMuteButtonUi() {
        if (isMuted) {
            btnMute.text = "Reactivar audio"
            btnMute.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#451A03"))
            btnMute.strokeColor = ColorStateList.valueOf(Color.parseColor("#F59E0B"))
            btnMute.setTextColor(Color.parseColor("#FDE68A"))
        } else {
            btnMute.text = "Silenciar audio"
            btnMute.backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
            btnMute.strokeColor = ColorStateList.valueOf(Color.parseColor("#2A323D"))
            btnMute.setTextColor(Color.parseColor("#F4F5F7"))
        }
    }

    private fun styleBadge(bgHex: String, textHex: String, label: String) {
        tvStateBadge.text = label
        tvStateBadge.setTextColor(Color.parseColor(textHex))
        val radiusPx = 8f * resources.displayMetrics.density
        tvStateBadge.background = GradientDrawable().apply {
            cornerRadius = radiusPx
            setColor(Color.parseColor(bgHex))
        }
    }

    private fun isStatusError(text: String): Boolean {
        val lower = text.lowercase()
        return lower.startsWith("error") ||
            lower.startsWith("http ") ||
            lower.startsWith("no se pudo") ||
            lower.startsWith("no se encontró") ||
            lower.startsWith("conecta este") ||
            lower.startsWith("ingresa ") ||
            lower.startsWith("usa la ip") ||
            lower.startsWith("código inválido")
    }

    private fun updateConnectButtonUi() {
        if (isConnected) {
            btnConnect.text = if (modeDirect) "Detener receptor Wi-Fi" else "Desconectar puente PC"
            btnConnect.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#DC2626"))
            btnConnect.setTextColor(Color.parseColor("#FFFFFF"))

            if (isSenderConnected) {
                cardTelemetry.strokeColor = Color.parseColor("#10B981")
                styleBadge("#064E3B", "#34D399", "● EN VIVO · RECIBIENDO AUDIO")
                tvConnectionStatus.setTextColor(Color.parseColor("#34D399"))
            } else {
                cardTelemetry.strokeColor = Color.parseColor("#0EA5E9")
                val badgeLabel = if (modeDirect) "● ACTIVO · ESPERANDO CHROME" else "● CONECTADO · ESPERANDO EMISOR"
                styleBadge("#0E2A3A", "#38BDF8", badgeLabel)
                tvConnectionStatus.setTextColor(Color.parseColor("#38BDF8"))
            }
        } else {
            if (modeDirect) {
                btnConnect.text = "Iniciar receptor Wi-Fi"
                btnConnect.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#10B981"))
                btnConnect.setTextColor(Color.parseColor("#042F2E"))
            } else {
                btnConnect.text = "Conectar al puente PC"
                btnConnect.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#0EA5E9"))
                btnConnect.setTextColor(Color.parseColor("#06121A"))
            }

            val currentMsg = tvConnectionStatus.text?.toString().orEmpty()
            if (isStatusError(currentMsg)) {
                cardTelemetry.strokeColor = Color.parseColor("#DC2626")
                styleBadge("#450A0A", "#FCA5A5", "● ERROR DE CONEXIÓN")
                tvConnectionStatus.setTextColor(Color.parseColor("#FCA5A5"))
            } else {
                cardTelemetry.strokeColor = Color.parseColor("#1F2630")
                styleBadge("#1F2630", "#9CA3AF", "● INACTIVO")
                tvConnectionStatus.setTextColor(Color.parseColor("#F4F5F7"))
            }
        }

        val lockedAlpha = if (isConnected) 0.55f else 1.0f
        etRoomCode.isEnabled = !isConnected
        etServerUrl.isEnabled = !isConnected
        btnScanLan.isEnabled = !isConnected
        btnModeDirect.isEnabled = !isConnected
        btnModeBridge.isEnabled = !isConnected
        btnModeDirect.alpha = lockedAlpha
        btnModeBridge.alpha = lockedAlpha
        btnScanLan.alpha = lockedAlpha
    }

    private fun refreshBluetoothOutput() {
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val btDevice = outputs.firstOrNull { device ->
            device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER))
        }
        val radiusPx = 10f * resources.displayMetrics.density
        if (btDevice != null) {
            val name = btDevice.productName?.toString()?.takeIf { it.isNotBlank() } ?: "Audífonos Bluetooth"
            tvBluetoothOutput.text = "Bluetooth conectado: $name"
            tvBluetoothBadge.text = "● BLUETOOTH"
            tvBluetoothBadge.setTextColor(Color.parseColor("#34D399"))
            tvBluetoothBadge.background = GradientDrawable().apply {
                cornerRadius = radiusPx
                setColor(Color.parseColor("#064E3B"))
            }
        } else {
            tvBluetoothOutput.text = "Altavoz del smartphone (conecta tus cascos Bluetooth)"
            tvBluetoothBadge.text = "● ALTAVOZ"
            tvBluetoothBadge.setTextColor(Color.parseColor("#FCD34D"))
            tvBluetoothBadge.background = GradientDrawable().apply {
                cornerRadius = radiusPx
                setColor(Color.parseColor("#451A03"))
            }
        }
    }

    private fun requestRequiredPermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }
}
