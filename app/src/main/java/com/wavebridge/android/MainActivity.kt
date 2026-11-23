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

class MainActivity : AppCompatActivity() {

    private lateinit var etRoomCode: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnPresetLocal: MaterialButton
    private lateinit var btnPresetCloud: MaterialButton
    private lateinit var btnConnect: MaterialButton
    private lateinit var btnMute: MaterialButton
    private lateinit var btnDiagnostics: MaterialButton
    private lateinit var tvBluetoothOutput: TextView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var tvTelemetry: TextView
    private lateinit var tvAppVersion: TextView
    private lateinit var seekVolume: SeekBar

    private val prefs by lazy { getSharedPreferences("wavebridge_prefs", Context.MODE_PRIVATE) }

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
        btnPresetLocal = findViewById(R.id.btnPresetLocal)
        btnPresetCloud = findViewById(R.id.btnPresetCloud)
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
        if (!savedServer.isNullOrBlank()) {
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

        btnPresetLocal.setOnClickListener {
            val current = etServerUrl.text.toString().trim()
            if (!current.startsWith("http://192.168.")) {
                etServerUrl.setText("http://192.168.1.50:3000")
            }
            etServerUrl.requestFocus()
            etServerUrl.setSelection(etServerUrl.text.length)
            Toast.makeText(this, "Ajusta la IP Wi-Fi de tu laptop (puerto 3000)", Toast.LENGTH_SHORT).show()
        }

        btnPresetCloud.setOnClickListener {
            etServerUrl.setText(getString(R.string.default_server_url))
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
                if (serverUrl.contains("ais-dev-")) {
                    val msg = "La URL ais-dev requiere sesión privada. Usa tu IP Wi-Fi local o la URL pública."
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
            appendLine("Servidor: ${etServerUrl.text}")
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

    private fun handleIncomingIntent(intent: Intent?) {
        val data = intent?.data ?: return
        val room = data.getQueryParameter("room")
        if (!room.isNullOrBlank()) {
            etRoomCode.setText(room.uppercase().take(6))
        }
        val server = data.getQueryParameter("server")
        if (!server.isNullOrBlank() && !server.contains("ais-dev-")) {
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
