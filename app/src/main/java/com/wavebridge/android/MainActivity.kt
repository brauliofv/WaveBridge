package com.wavebridge.android

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.widget.EditText
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
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

    private lateinit var etRoomCode: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnScanLan: MaterialButton
    private lateinit var btnConnect: MaterialButton
    private lateinit var btnMute: MaterialButton
    private lateinit var btnDiagnostics: MaterialButton
    private lateinit var tvBluetoothOutput: TextView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var tvTelemetry: TextView
    private lateinit var tvAppVersion: TextView
    private lateinit var seekVolume: SeekBar

    private val prefs by lazy { getSharedPreferences("wavebridge_prefs", Context.MODE_PRIVATE) }
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var scanJob: Job? = null

    private lateinit var audioManager: AudioManager
    private var isMuted = false
    private var isConnected = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshBluetoothOutput()
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AudioBridgeService.ACTION_STATE_UPDATE) return
            isConnected = intent.getBooleanExtra(AudioBridgeService.EXTRA_IS_CONNECTED, false)
            val statusText = intent.getStringExtra(AudioBridgeService.EXTRA_STATUS_TEXT) ?: "Desconectado"
            val rttMs = intent.getLongExtra(AudioBridgeService.EXTRA_RTT_MS, -1L)
            val packets = intent.getLongExtra(AudioBridgeService.EXTRA_PACKETS, 0L)

            tvConnectionStatus.text = statusText
            val rttStr = if (rttMs >= 0) "$rttMs ms" else "—"
            tvTelemetry.text = "Latencia RTT: $rttStr · Paquetes: $packets"
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

        etRoomCode = findViewById(R.id.etRoomCode)
        etServerUrl = findViewById(R.id.etServerUrl)
        btnScanLan = findViewById(R.id.btnScanLan)
        btnConnect = findViewById(R.id.btnConnect)
        btnMute = findViewById(R.id.btnMute)
        btnDiagnostics = findViewById(R.id.btnDiagnostics)
        tvBluetoothOutput = findViewById(R.id.tvBluetoothOutput)
        tvConnectionStatus = findViewById(R.id.tvConnectionStatus)
        tvTelemetry = findViewById(R.id.tvTelemetry)
        tvAppVersion = findViewById(R.id.tvAppVersion)
        seekVolume = findViewById(R.id.seekVolume)

        tvAppVersion.text = "v${BuildConfig.VERSION_NAME} · ${BuildConfig.BUILD_DATE}"

        val savedServer = prefs.getString("server_url", null)
        if (!savedServer.isNullOrBlank() && isLocalLanUrl(savedServer)) {
            etServerUrl.setText(savedServer)
        }
        val savedRoom = prefs.getString("room_code", null)
        if (!savedRoom.isNullOrBlank()) {
            etRoomCode.setText(savedRoom)
        }

        audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        requestRequiredPermissions()
        handleIncomingIntent(intent)

        isConnected = AudioBridgeService.currentIsConnected
        if (AudioBridgeService.currentRoomCode.isNotEmpty()) {
            etRoomCode.setText(AudioBridgeService.currentRoomCode)
        }
        updateConnectButtonUi()

        btnScanLan.setOnClickListener {
            scanLocalWifiForBridge()
        }

        btnConnect.setOnClickListener {
            if (isConnected) {
                val stopIntent = Intent(this, AudioBridgeService::class.java).apply {
                    action = AudioBridgeService.ACTION_DISCONNECT
                }
                startService(stopIntent)
            } else {
                val room = etRoomCode.text.toString().uppercase().replace(Regex("[^A-Z0-9]"), "")
                val serverUrl = etServerUrl.text.toString().trim()
                if (room.length != 6) {
                    val msg = "Código inválido: debe tener 6 caracteres"
                    tvConnectionStatus.text = "Ingresa un código válido de 6 caracteres"
                    AudioBridgeService.recordError(msg)
                    return@setOnClickListener
                }
                if (!isLocalLanUrl(serverUrl)) {
                    val msg = "Usa la IP local Wi-Fi de tu laptop (ej. http://192.168.1.50:3000)"
                    tvConnectionStatus.text = msg
                    AudioBridgeService.recordError(msg)
                    return@setOnClickListener
                }
                prefs.edit()
                    .putString("room_code", room)
                    .putString("server_url", serverUrl)
                    .apply()
                val startIntent = Intent(this, AudioBridgeService::class.java).apply {
                    action = AudioBridgeService.ACTION_CONNECT
                    putExtra(AudioBridgeService.EXTRA_ROOM_CODE, room)
                    putExtra(AudioBridgeService.EXTRA_SERVER_URL, serverUrl)
                }
                ContextCompat.startForegroundService(this, startIntent)
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
            btnMute.text = if (isMuted) "Reactivar audio" else "Silenciar audio"
            sendVolumeUpdate(seekVolume.progress / 100f, isMuted)
        }

        btnDiagnostics.setOnClickListener {
            shareDiagnosticReport()
        }
    }

    private fun scanLocalWifiForBridge() {
        scanJob?.cancel()
        btnScanLan.isEnabled = false
        btnScanLan.text = "Buscando PC en Wi-Fi..."
        tvConnectionStatus.text = "Escaneando red Wi-Fi local (puerto 3000)..."

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
                Toast.makeText(this@MainActivity, "PC detectada en $foundUrl", Toast.LENGTH_SHORT).show()
            } else {
                val msg = "No se encontró el puente en tu Wi-Fi. Asegúrate de ejecutar 'npm start' en la laptop."
                tvConnectionStatus.text = msg
                AudioBridgeService.recordError(msg)
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
                connectTimeout = 350
                readTimeout = 450
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
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            var fallback: String? = null
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (ip.startsWith("192.168.") || ip.startsWith("10.")) return ip
                        if (ip.startsWith("172.")) fallback = ip
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
        val report = buildString {
            appendLine("=== WaveBridge Android Diagnóstico ===")
            appendLine("App: v${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_DATE})")
            appendLine("Dispositivo: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})")
            appendLine("Salida: ${tvBluetoothOutput.text}")
            appendLine("Estado: ${tvConnectionStatus.text}")
            appendLine("Telemetría: ${tvTelemetry.text}")
            appendLine("Sala: ${etRoomCode.text}")
            appendLine("Servidor local: ${etServerUrl.text}")
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
            etServerUrl.setText(server.trim())
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

    private fun updateConnectButtonUi() {
        btnConnect.text = if (isConnected) "Desconectar receptor" else "Conectar al emisor"
        etRoomCode.isEnabled = !isConnected
        etServerUrl.isEnabled = !isConnected
        btnScanLan.isEnabled = !isConnected
    }

    private fun refreshBluetoothOutput() {
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val btDevice = outputs.firstOrNull { device ->
            device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER))
        }
        if (btDevice != null) {
            val name = btDevice.productName?.toString()?.takeIf { it.isNotBlank() } ?: "Audífonos Bluetooth"
            tvBluetoothOutput.text = "Bluetooth conectado: $name"
        } else {
            tvBluetoothOutput.text = "Altavoz del smartphone (conecta tus cascos Bluetooth)"
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
