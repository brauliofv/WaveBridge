# WaveBridge — Audio del Navegador a Audífonos Bluetooth vía Smartphone

> **AVISO IMPORTANTE (3 modos disponibles según tu red Wi-Fi):**  
> En la mayoría de redes domésticas **no necesitas abrir ninguna terminal**: instala **`wavebridge.apk`** en tu Android, carga la extensión en Google Chrome y usa el modo **Directo al móvil** (*Plan A*).
>
> **¿No se conecta a la primera?** Usa uno de estos dos respaldos en tu laptop (dentro de la carpeta `WaveBridge`):
> - **Plan B — Puente ligero en Python (sin instalar nada):**
>   - **Linux (prioritario):** `python3 bridge.py` *(si el firewall bloquea el puerto, abre una vez: `sudo ufw allow 3000/tcp`)*
>   - **Windows:** `py bridge.py` *(o `python bridge.py`)*
> - **Plan C — Interfaz Web completa con Node.js / `npm` (última opción):**
>   - **Linux:** `sudo apt update && sudo apt install -y nodejs npm` *(si no tienes `npm`)* y luego `npm install && npm run build && npm run web`
>   - **Windows (con Node.js LTS):** `npm install && npm run build && npm run web`

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
PLAN A (Directo, sin terminal en la laptop):
[Extensión Chrome] ──(Wi-Fi Local · ws://<IP-Android>:8765/ws)──▶ [App Android] ──▶ [Bluetooth]

PLAN B (Puente Python ligero sin dependencias):
[Extensión Chrome] ──▶ [python3 bridge.py (:3000)] ──(Wi-Fi Local)──▶ [App Android] ──▶ [Bluetooth]

PLAN C (Última opción: Interfaz Web Node.js + QR o Extensión):
[Consola Web http://localhost:3000 / Extensión] ──▶ [npm run web (:3000)] ──▶ [App Android o Web QR] ──▶ [Bluetooth]
```

---

## Guía de instalación y uso

### 1. Instalar la App en Android

1. Descarga **`wavebridge.apk`** desde **[Releases](../../releases/latest)** e instálalo en tu teléfono.
2. Conecta tus **audífonos Bluetooth** al smartphone.
3. Abre **WaveBridge** conectado al mismo Wi-Fi que tu laptop: el receptor directo arrancará automáticamente mostrando tu IP local (puerto `8765`) y un código de sala de 6 caracteres.

### 2. Instalar la Extensión en Google Chrome (Laptop)

> **Carpeta de la extensión:** todos los archivos listos para cargar están en **[`chrome-extension/`](./chrome-extension/)**.

1. Descarga o clona este repositorio en tu laptop.
2. En Google Chrome entra a `chrome://extensions` y activa **Modo de desarrollador**.
3. Haz clic en **Cargar descomprimida** y selecciona la carpeta **`chrome-extension/`**.
4. Fija **WaveBridge** en la barra de herramientas de Chrome.

### 3. Plan A — Conectar directo (Sin comandos en terminal)

1. Abre la extensión **WaveBridge** en Chrome (**Directo al móvil**).
2. Pulsa **Buscar móvil** *(detecta tu Android en tu Wi-Fi y autocompleta la IP y la sala)*.
3. Deja seleccionado **Todo el navegador** y pulsa **Transmitir todo el navegador**.
4. Elige **Pantalla completa** y marca **Compartir también el audio del sistema**.

---

## Plan B — Puente Python local (`python3 bridge.py`)

Si tu router tiene *Aislamiento AP*, VPN o bloqueo de conexión directa hacia el teléfono:

1. En la carpeta del proyecto (`WaveBridge`), ejecuta en terminal:
   - **Linux:**
     ```bash
     python3 bridge.py
     ```
     *(Si el teléfono no logra conectar al puerto `3000`, permite el puerto en el firewall una sola vez: `sudo ufw allow 3000/tcp`)*.
   - **Windows:**
     ```bat
     py bridge.py
     ```
     *(o `python bridge.py`)*.
2. En la extensión de Chrome cambia a **Puente PC (Plan B)**: verificará `http://localhost:3000` y te mostrará un recuadro con **la IP exacta que debes usar en Android** (ej. `http://192.168.100.12:3000`) con un botón **Copiar IP**.
3. En la app de Android cambia el selector a **Puente PC (Plan B)**: buscará tu laptop automáticamente en la misma subred Wi-Fi (o pega/escribe la IP que mostró `bridge.py`), verifica que coincida el código de sala y pulsa **Conectar al puente PC**.

---

## Plan C — Interfaz Web completa con Node.js / `npm` (Última opción)

Si prefieres ejecutar toda la interfaz web (para emitir directamente sin usar extensión y conectar tu smartphone escaneando un código **QR** desde el navegador del teléfono o desde la app Android):

1. Instala Node.js y `npm` si aún no los tienes:
   - **Linux (Ubuntu / Debian / Mint):**
     ```bash
     sudo apt update && sudo apt install -y nodejs npm
     ```
   - **Windows:** instala [Node.js LTS](https://nodejs.org/).
2. Dentro de la carpeta del proyecto ejecuta:
   ```bash
   npm install
   npm run build
   npm run web
   ```
   *(El repositorio ya incluye `.npmrc` con `legacy-peer-deps=true`; si usas una versión antigua de `npm`, también puedes usar `npm install --legacy-peer-deps`. Como alternativa directa sin compilar, también funciona `npm run dev`.)*
3. Abre `http://localhost:3000` en Chrome (pestaña **Emisor PC**) y escanea el código **QR** desde tu smartphone (o usa la app Android en **Puente PC** hacia la IP que imprime la terminal).

---

## Reporte rápido de errores y versión

- Tanto la **App Android** (`v1.0.5`) como la **Extensión** (`v1.0.4`) y la **Interfaz Web** (`v1.0.5`) muestran la versión actual y la fecha junto al botón **Reportar error** / **Diagnóstico**.
- Al pulsarlo se copia/comparte automáticamente el detalle técnico completo para diagnosticar cualquier problema de red o captura.

---

## Estructura del repositorio

| Ruta | Descripción |
| :--- | :--- |
| `app/` | App nativa Android en Kotlin con buffer acotado de baja latencia (`LocalAudioServer`, `AudioBridgeService`, `AudioPacketDecoder`, `MainActivity`). |
| `chrome-extension/` | Extensión Manifest V3 con `AudioWorklet` de baja latencia (`manifest.json`, `popup.*`, `background.js`, `offscreen.*`, `pcm-worklet.js`). |
| `bridge.py` | **Plan B:** puente Wi-Fi local en Python 3 sin dependencias (`python3 bridge.py`). |
| `server.ts` y `src/` | **Plan C:** servidor Node.js + interfaz web completa (Emisor PC, Receptor QR y empaquetador `.zip`). |
| `.github/workflows/build-apk.yml` | Workflow de GitHub Actions que compila y publica `wavebridge.apk` en Releases (sin incluir la extensión). |

---

## Consejos de baja latencia

- Conecta laptop y smartphone a **Wi-Fi de 5 GHz** (o la laptop por cable Ethernet al router).
- En Android, desactiva la optimización agresiva de batería para **WaveBridge** si escuchas sesiones largas con pantalla apagada.
