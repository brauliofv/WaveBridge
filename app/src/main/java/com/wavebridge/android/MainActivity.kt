package com.wavebridge.android

import android.Manifest
import android.content.BroadcastReceiver
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {

    private lateinit var etRoomCode: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnConnect: MaterialButton
    private lateinit var btnMute: MaterialButton
    private lateinit var tvBluetoothOutput: TextView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var tvTelemetry: TextView
    private lateinit var seekVolume: SeekBar

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
        btnConnect = findViewById(R.id.btnConnect)
        btnMute = findViewById(R.id.btnMute)
        tvBluetoothOutput = findViewById(R.id.tvBluetoothOutput)
        tvConnectionStatus = findViewById(R.id.tvConnectionStatus)
        tvTelemetry = findViewById(R.id.tvTelemetry)
        seekVolume = findViewById(R.id.seekVolume)

        audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        requestRequiredPermissions()
        handleIncomingIntent(intent)

        isConnected = AudioBridgeService.currentIsConnected
        if (AudioBridgeService.currentRoomCode.isNotEmpty()) {
            etRoomCode.setText(AudioBridgeService.currentRoomCode)
        }
        updateConnectButtonUi()

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
                    tvConnectionStatus.text = "Ingresa un código válido de 6 caracteres"
                    return@setOnClickListener
                }
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
