# WaveBridge — Audio del Navegador a Audífonos Bluetooth vía Smartphone

**WaveBridge** convierte tu smartphone Android en un receptor inalámbrico de baja latencia para tu laptop o PC sin Bluetooth. Captura la música, videos, clases o transmisiones de cualquier pestaña de Google Chrome y envíalos por Wi-Fi en tiempo real directamente hacia los audífonos Bluetooth emparejados con tu teléfono.

---

## Descarga rápida

- **App Android (`wavebridge.apk`)**:  
  [Descargar última versión desde GitHub Releases](../../releases/latest) *(archivo `wavebridge.apk`)*
- **Extensión para Google Chrome**:  
  Se encuentra lista para usar dentro de la carpeta **[`chrome-extension/`](./chrome-extension/)** de este repositorio (no requiere compilación).

---

## Cómo funciona

```text
[Navegador Chrome (Laptop)]
   │  Captura audio de pestaña (chrome.tabCapture / Web Audio)
   ▼
[Servidor Puente WaveBridge (Wi-Fi / WebSocket & WebRTC)]
   │  Transmisión en tiempo real 48 kHz estéreo (baja latencia)
   ▼
[App Android WaveBridge (AudioTrack + ForegroundService)]
   │  Mantiene reproducción activa incluso con pantalla apagada
   ▼
[Audífonos inalámbricos Bluetooth (A2DP / LE Audio)]
```

1. **Emisor en Chrome (Laptop)**: Captura el sonido de YouTube, Spotify Web, Twitch, Netflix o cualquier pestaña activa.
2. **Puente Wi-Fi**: Empareja laptop y teléfono mediante un código de sala de 6 caracteres (ej. `WVB492`) o código QR. Utiliza WebRTC Opus y tramas binarias PCM por WebSocket a 48 kHz estéreo.
3. **Receptor en Android**: Reproduce el flujo de audio en tiempo real mediante `AudioTrack` en modo de baja latencia y lo envía automáticamente a los audífonos Bluetooth conectados al smartphone.

---

## Guía de instalación y uso

### 1. Instalar la App en tu Smartphone Android

1. Descarga **`wavebridge.apk`** desde la sección **[Releases](../../releases/latest)** de este repositorio directamente en tu teléfono.
2. Abre el archivo descargado y autoriza la instalación de aplicaciones de fuentes desconocidas si Android lo solicita.
3. Empareja tus **audífonos Bluetooth** con el smartphone como lo haces habitualmente.

### 2. Instalar la Extensión en Google Chrome (Laptop)

> **Aviso importante:** Todos los archivos de la extensión se encuentran en la carpeta **[`chrome-extension/`](./chrome-extension/)** de este proyecto.

1. Descarga o clona este repositorio en tu laptop.
2. Abre Google Chrome y entra en `chrome://extensions`.
3. Activa el interruptor **Modo de desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta **`chrome-extension/`**.
5. Fija el icono de **WaveBridge** en la barra de herramientas de Chrome.

*(Alternativamente, desde la consola web de WaveBridge también puedes generar y descargar un `.zip` de la extensión en la pestaña **Extensión Chrome**).*

### 3. Iniciar el puente Wi-Fi local y conectar (100% en tu red local, sin internet)

WaveBridge **no envía tu audio a la nube**. Toda la transmisión ocurre dentro de tu propio router Wi-Fi entre tu laptop y tu smartphone:

1. En la carpeta del proyecto en tu laptop, inicia el puente local **sin instalar dependencias** usando Python 3 (incluido por defecto en Ubuntu, Debian, Linux Mint y macOS):
   ```bash
   python3 bridge.py
   ```
   *(Quedará escuchando en `http://localhost:3000` dentro de tu Wi-Fi local y te mostrará en consola la IP de tu laptop para Android).*

   > *(Opcional)* Si prefieres ejecutar el servidor Node.js con la consola web completa en Ubuntu/Debian y no tienes `npm`, instálalo con `sudo apt update && sudo apt install -y nodejs npm` y luego ejecuta `npm install && npm run build && npm start`.

2. Haz clic en el icono de la extensión **WaveBridge** en Chrome: verificará `http://localhost:3000` automáticamente y te mostrará también la **IP Wi-Fi para Android** (por ejemplo `http://192.168.1.50:3000`).
3. Selecciona **Todo el navegador** (para escuchar todas tus pestañas y notificaciones) y pulsa **Transmitir todo el navegador**. En la ventana de Chrome elige **Pantalla completa** y marca **Compartir también el audio del sistema**.
4. Abre la app **WaveBridge** en tu Android (conectado al mismo Wi-Fi), pulsa **Buscar PC automáticamente en Wi-Fi** (o escribe la IP local que te mostró la extensión), ingresa el código de sala de 6 caracteres y pulsa **Conectar al emisor**.
5. ¡Listo! Todo el audio del navegador sonará directamente en tus audífonos inalámbricos sin salir de tu red local. Puedes bloquear la pantalla del teléfono y el servicio en segundo plano mantendrá la reproducción activa.

---

## Estructura del repositorio

| Ruta | Descripción |
| :--- | :--- |
| `bridge.py` | Puente Wi-Fi local en Python 3 (cero dependencias externas: solo ejecuta `python3 bridge.py`). |
| `chrome-extension/` | Extensión de Chrome Manifest V3 (`manifest.json`, `popup.*`, `background.js`, `offscreen.*`) lista para cargar descomprimida. |
| `app/` | Código fuente nativo Android en Kotlin (`AudioBridgeService`, `AudioPacketDecoder`, `MainActivity`). |
| `.github/workflows/build-apk.yml` | Workflow de GitHub Actions que compila y publica `wavebridge.apk` en Releases (sin incluir la extensión). |
| `server.ts` | Servidor puente alternativo Express + WebSocket (`/ws`) en Node.js con consola web. |
| `src/` | Consola web interactiva (Emisor PC, Receptor Móvil Web, Empaquetador de extensión y Guía). |

---

## Consejos de baja latencia

- Conecta la laptop y el smartphone a una red **Wi-Fi de 5 GHz** (o la laptop por cable Ethernet al router).
- Si usas el **Receptor Web** en lugar de la APK, escanea el código QR desde la pestaña **Emisor PC** para conectar automáticamente sin escribir el código.
