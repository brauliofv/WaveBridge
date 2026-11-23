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

### 3. Conectar y escuchar en tiempo real

1. Haz clic en el icono de la extensión **WaveBridge**, verifica la URL del servidor puente y anota tu **código de sala de 6 caracteres**.
2. Selecciona **Todo el navegador** (recomendado para escuchar todas tus pestañas, notificaciones, YouTube y Spotify a la vez sin cambiar de pestaña) y pulsa **Transmitir todo el navegador**. En la ventana de Chrome elige **Pantalla completa** y marca la casilla **Compartir también el audio del sistema**. *(Si solo quieres aislar una pestaña, elige **Solo esta pestaña**).*
3. Abre la app **WaveBridge** en tu Android, ingresa el mismo código de sala (y la misma URL del servidor puente) y pulsa **Conectar al emisor**.
4. ¡Listo! Todo el audio del navegador sonará en tus audífonos inalámbricos aunque trabajes cambiando entre muchas pestañas. Puedes bloquear la pantalla del teléfono y el servicio en segundo plano mantendrá la reproducción activa.

---

## Uso en red Wi-Fi local (Máxima velocidad y mínima latencia)

Para obtener la latencia más baja posible (recomendado para ver videos o películas sin desfase labial), ejecuta el servidor puente directamente en tu laptop dentro de la misma red Wi-Fi 5 GHz que tu smartphone:

```bash
npm install
npm run dev
```

El servidor quedará escuchando en el puerto `3000`. Luego usa la IP local de tu laptop (por ejemplo `http://192.168.1.50:3000`) tanto en el campo **Servidor puente** de la extensión de Chrome como en la app Android.

---

## Estructura del repositorio

| Ruta | Descripción |
| :--- | :--- |
| `chrome-extension/` | Extensión de Chrome Manifest V3 (`manifest.json`, `popup.*`, `background.js`, `offscreen.*`) lista para cargar descomprimida. |
| `app/` | Código fuente nativo Android en Kotlin (`AudioBridgeService`, `AudioPacketDecoder`, `MainActivity`). |
| `.github/workflows/build-apk.yml` | Workflow de GitHub Actions que compila y publica `wavebridge.apk` en Releases (sin incluir la extensión). |
| `server.ts` | Servidor puente Express + WebSocket (`/ws`) para señalización WebRTC y retransmisión PCM de baja latencia. |
| `src/` | Consola web interactiva (Emisor PC, Receptor Móvil Web, Empaquetador de extensión y Guía). |

---

## Consejos de baja latencia

- Conecta la laptop y el smartphone a una red **Wi-Fi de 5 GHz** (o la laptop por cable Ethernet al router).
- Si usas el **Receptor Web** en lugar de la APK, escanea el código QR desde la pestaña **Emisor PC** para conectar automáticamente sin escribir el código.
