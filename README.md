# WaveBridge — Audio del Navegador a Audífonos Bluetooth vía Smartphone

> **AVISO IMPORTANTE (Modo sin terminal vs Plan B):**  
> En la mayoría de redes Wi-Fi domésticas **no necesitas abrir ninguna consola ni instalar nada extra**: instala **`wavebridge.apk`** en tu teléfono Android, carga la extensión en Google Chrome y usa el modo **Directo al móvil** (*Buscar móvil* → *Transmitir todo el navegador*).
>
> **¿No logra conectarse a la primera** (router con aislamiento AP, VPN o bloqueo de red privada de Chrome)? Usa el **Plan B (Puente PC)** ejecutando un solo comando dentro de la carpeta del proyecto:
> - **Linux (prioritario):** `python3 bridge.py`
> - **Windows:** `py bridge.py` *(o `python bridge.py`)*

**WaveBridge** convierte tu smartphone Android en un receptor inalámbrico de baja latencia para tu laptop o PC sin Bluetooth. Captura el audio de **todo el navegador Chrome** (todas tus pestañas, notificaciones, YouTube, Spotify) o de una sola pestaña, y envíalo **100% dentro de tu Wi-Fi local (sin pasar por la nube)** directamente a los audífonos Bluetooth emparejados con tu teléfono.

---

## Descarga rápida

- **App Android (`wavebridge.apk`)**:  
  [Descargar última versión desde GitHub Releases](../../releases/latest) *(archivo `wavebridge.apk`)*
- **Extensión para Google Chrome**:  
  Se encuentra lista para usar dentro de la carpeta **[`chrome-extension/`](./chrome-extension/)** de este repositorio (no requiere compilación).

---

## Cómo funciona

```text
MODO DIRECTO (Por defecto, sin terminal en la laptop):
[Extensión Chrome (Laptop)] ──(Wi-Fi Local · ws://<IP-Android>:8765/ws)──▶ [App WaveBridge Android] ──▶ [Audífonos Bluetooth]

PLAN B (Si tu router o firewall bloquea la conexión directa):
[Extensión Chrome (Laptop)] ──▶ [python3 bridge.py (:3000)] ──(Wi-Fi Local)──▶ [App WaveBridge Android] ──▶ [Audífonos Bluetooth]
```

1. **Receptor directo en Android**: Al abrir **WaveBridge** en tu smartphone, inicia automáticamente un servidor local en el puerto **`8765`** dentro de tu Wi-Fi y muestra su **IP local** y su **código de sala de 6 caracteres**.
2. **Emisor en Chrome (Laptop)**: Captura **Todo el navegador** (`desktopCapture`, ideal para escuchar música y notificaciones de otras pestañas) o **Solo esta pestaña** (`tabCapture`) a 48 kHz estéreo, encuentra automáticamente tu teléfono en el Wi-Fi y transmite directo sin salir de tu router.
3. **Salida Bluetooth dedicada**: Tu teléfono reproduce el audio en baja latencia vía `AudioTrack` y lo envía automáticamente por Bluetooth (SBC/AAC/aptX/LDAC) a tus cascos inalámbricos incluso con la pantalla bloqueada.

---

## Guía de instalación y uso

### 1. Instalar la App en tu Smartphone Android

1. Descarga **`wavebridge.apk`** desde **[Releases](../../releases/latest)** directamente en tu teléfono e instálalo.
2. Conecta tus **audífonos Bluetooth** al smartphone como lo haces habitualmente.
3. Conecta el teléfono al **mismo Wi-Fi** que tu laptop y abre **WaveBridge**: el receptor en modo **Directo (Sin PC)** arrancará solo y mostrará la IP de tu móvil (ej. `192.168.1.42:8765`) y tu código de sala de 6 caracteres.

### 2. Instalar la Extensión en Google Chrome (Laptop)

> **Carpeta de la extensión:** todos los archivos listos para cargar están en **[`chrome-extension/`](./chrome-extension/)**.

1. Descarga o clona este repositorio en tu laptop.
2. Abre Google Chrome y entra en `chrome://extensions`.
3. Activa **Modo de desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta **`chrome-extension/`**.
5. Fija el icono de **WaveBridge** en la barra de herramientas de Chrome.

### 3. Conectar y transmitir (Sin comandos en terminal)

1. Abre la extensión **WaveBridge** en Chrome (verás seleccionado **Directo al móvil**).
2. Pulsa **Buscar móvil** *(detecta automáticamente tu smartphone en tu Wi-Fi y completa el código de sala; si prefieres, escribe la IP que muestra el teléfono)*.
3. Deja seleccionado **Todo el navegador** y pulsa **Transmitir todo el navegador**.
4. En la ventana que abre Chrome elige **Pantalla completa** y marca la casilla **Compartir también el audio del sistema**.
5. ¡Listo! Todo el audio del navegador sonará directamente en tus audífonos inalámbricos en tiempo real y sin usar internet ni nube.

---

## Plan B: Si no se conecta en modo directo

Algunas redes Wi-Fi de oficina/universidad o configuraciones estrictas de firewall bloquean que la laptop se conecte al puerto `8765` del teléfono (*AP Isolation* o bloqueo de red privada). En ese caso:

1. En tu laptop, abre una terminal dentro de la carpeta del proyecto (`WaveBridge-main`) y ejecuta **un solo comando**:
   - **Linux:**
     ```bash
     python3 bridge.py
     ```
   - **Windows (PowerShell o CMD):**
     ```bat
     py bridge.py
     ```
     *(Si `py` no está registrado, ejecuta `python bridge.py`)*.
2. En la extensión de Chrome cambia el selector de arriba a **Puente PC (Plan B)**.
3. En la app de Android cambia el selector a **Puente PC (Plan B)** y pulsa **Buscar PC automáticamente en Wi-Fi** (o escribe la IP que imprimió `bridge.py` en tu terminal, por ejemplo `http://192.168.1.50:3000`).
4. Ingresa el mismo código de sala de 6 caracteres en ambos lados y pulsa **Conectar al puente PC** + **Transmitir**.

> **Nota opcional (Node.js):** Si deseas abrir también la consola web completa (`src/`), puedes usar Node.js (`npm install && npm run build && npm start`; en Ubuntu/Debian sin `npm`, instálalo con `sudo apt update && sudo apt install -y nodejs npm`).

---

## Reporte rápido de errores y versión

- Tanto la **App Android** como la **Extensión de Chrome** muestran discretamente al pie la versión actual (`v1.0.2` y fecha) junto al botón **Reportar error** / **Diagnóstico**.
- Si ocurre cualquier fallo, púlsalo para copiar o compartir automáticamente la versión, modo activo, IP/servidor, estado de Bluetooth y los últimos errores registrados.

---

## Estructura del repositorio

| Ruta | Descripción |
| :--- | :--- |
| `app/` | Código fuente nativo Android en Kotlin (`LocalAudioServer`, `AudioBridgeService`, `AudioPacketDecoder`, `MainActivity`). |
| `chrome-extension/` | Extensión de Chrome Manifest V3 lista para cargar descomprimida (modo directo `:8765` + Plan B `:3000`). |
| `bridge.py` | Puente Wi-Fi local Plan B en Python 3 sin dependencias externas (`python3 bridge.py` en Linux / `py bridge.py` en Windows). |
| `.github/workflows/build-apk.yml` | Workflow de GitHub Actions que compila y publica `wavebridge.apk` en Releases (sin incluir la extensión). |
| `server.ts` | Servidor alternativo en Node.js + Express + WebSocket (`/ws`) con consola web. |
| `src/` | Consola web interactiva (Emisor PC, Receptor Móvil Web, Empaquetador `.zip` y Guía). |

---

## Consejos de baja latencia

- Conecta laptop y smartphone a una red **Wi-Fi de 5 GHz** (o la laptop por cable Ethernet al router).
- En Android, si escuchas largas sesiones con pantalla apagada, desactiva la optimización agresiva de batería para **WaveBridge**.
