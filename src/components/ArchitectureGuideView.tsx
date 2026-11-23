export function ArchitectureGuideView() {
  const stages = [
    {
      step: '01',
      title: 'Captura en Chrome (Laptop)',
      detail:
        'La extensión usa chrome.tabCapture o getDisplayMedia sin compresión destructiva, manteniendo el audio de YouTube, Spotify o videollamadas a 48 kHz estéreo.',
      metric: '~3 ms captura',
    },
    {
      step: '02',
      title: 'Transporte Wi-Fi WebRTC / WS',
      detail:
        'Prioriza WebRTC UDP con códec Opus (hasta 256 kbps) con corrección de errores FEC, y cambia automáticamente a tramas binarias PCM por WebSocket si el firewall bloquea UDP.',
      metric: '8 – 18 ms red local',
    },
    {
      step: '03',
      title: 'Buffer Adaptativo en Android',
      detail:
        'El receptor ajusta el jitter buffer entre 15 ms (video/juegos) y 80 ms (música continua), manteniendo la pantalla despierta con WakeLock y controles en audífonos vía MediaSession.',
      metric: '15 – 40 ms buffer',
    },
    {
      step: '04',
      title: 'Salida Bluetooth del Smartphone',
      detail:
        'El teléfono actúa como puente Bluetooth dedicado hacia tus cascos inalámbricos (SBC, AAC, aptX o LDAC), resolviendo la falta de hardware Bluetooth en la laptop.',
      metric: 'Ruta nativa A2DP / LE',
    },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 pb-24 sm:px-6 lg:py-8 md:pb-8 space-y-8">
      <div className="border-b border-white/10 pb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F5F7] sm:text-3xl text-balance">
          Arquitectura de Baja Latencia Wi-Fi a Bluetooth
        </h1>
        <p className="mt-1.5 text-sm text-[#9CA3AF] max-w-2xl">
          Cómo WaveBridge convierte tu smartphone Android en una tarjeta de sonido Bluetooth externa conectada por Wi-Fi a tu navegador.
        </p>
      </div>

      {/* Signal Chain SVG Diagram */}
      <section
        aria-label="Diagrama de flujo de señal de audio"
        className="rounded-2xl border border-white/10 bg-[#13171D] p-5 sm:p-6"
      >
        <svg
          viewBox="0 0 960 170"
          className="w-full h-auto"
          role="img"
          aria-label="Flujo de audio desde Chrome en laptop por Wi-Fi hasta smartphone Android y audífonos Bluetooth"
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#0EA5E9" />
            </marker>
          </defs>

          {/* Node 1 */}
          <rect x="10" y="30" width="200" height="106" rx="14" fill="#0B0D10" stroke="rgba(255,255,255,0.14)" />
          <text x="28" y="64" fill="#F4F5F7" fontSize="15" fontWeight="600" fontFamily="Outfit, sans-serif">
            Navegador Chrome
          </text>
          <text x="28" y="88" fill="#9CA3AF" fontSize="12" fontFamily="Plus Jakarta Sans, sans-serif">
            tabCapture / AudioContext
          </text>
          <text x="28" y="114" fill="#38BDF8" fontSize="12" fontFamily="JetBrains Mono, monospace">
            48 kHz Estéreo
          </text>

          <line x1="215" y1="83" x2="255" y2="83" stroke="#0EA5E9" strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Node 2 */}
          <rect x="262" y="30" width="200" height="106" rx="14" fill="#0B0D10" stroke="rgba(255,255,255,0.14)" />
          <text x="280" y="64" fill="#F4F5F7" fontSize="15" fontWeight="600" fontFamily="Outfit, sans-serif">
            Puente Wi-Fi Local
          </text>
          <text x="280" y="88" fill="#9CA3AF" fontSize="12" fontFamily="Plus Jakarta Sans, sans-serif">
            WebRTC Opus / WS PCM
          </text>
          <text x="280" y="114" fill="#38BDF8" fontSize="12" fontFamily="JetBrains Mono, monospace">
            128–256 kbps · FEC
          </text>

          <line x1="467" y1="83" x2="507" y2="83" stroke="#0EA5E9" strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Node 3 */}
          <rect x="514" y="30" width="200" height="106" rx="14" fill="#0B0D10" stroke="rgba(255,255,255,0.14)" />
          <text x="532" y="64" fill="#F4F5F7" fontSize="15" fontWeight="600" fontFamily="Outfit, sans-serif">
            Smartphone Android
          </text>
          <text x="532" y="88" fill="#9CA3AF" fontSize="12" fontFamily="Plus Jakarta Sans, sans-serif">
            Jitter Buffer + WakeLock
          </text>
          <text x="532" y="114" fill="#38BDF8" fontSize="12" fontFamily="JetBrains Mono, monospace">
            15–80 ms adaptativo
          </text>

          <line x1="719" y1="83" x2="759" y2="83" stroke="#0EA5E9" strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Node 4 */}
          <rect x="766" y="30" width="184" height="106" rx="14" fill="#0B0D10" stroke="rgba(16,185,129,0.45)" />
          <text x="784" y="64" fill="#F4F5F7" fontSize="15" fontWeight="600" fontFamily="Outfit, sans-serif">
            Cascos Bluetooth
          </text>
          <text x="784" y="88" fill="#9CA3AF" fontSize="12" fontFamily="Plus Jakarta Sans, sans-serif">
            Salida inalámbrica A2DP
          </text>
          <text x="784" y="114" fill="#10B981" fontSize="12" fontFamily="JetBrains Mono, monospace">
            AAC / aptX / LDAC
          </text>
        </svg>
      </section>

      {/* 4-Stage Pipeline Details */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {stages.map((item) => (
          <article
            key={item.step}
            className="rounded-2xl border border-white/10 bg-[#13171D] p-6 space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-[#0EA5E9]">Etapa {item.step}</span>
              <span className="font-mono tabular-nums text-[#9CA3AF]">{item.metric}</span>
            </div>
            <h2 className="font-display text-lg font-semibold text-[#F4F5F7]">{item.title}</h2>
            <p className="text-sm text-[#9CA3AF] leading-relaxed">{item.detail}</p>
          </article>
        ))}
      </div>

      {/* Tips for lowest latency */}
      <section className="rounded-2xl border border-white/10 bg-[#13171D] p-6 space-y-3">
        <h2 className="font-display text-lg font-semibold text-[#F4F5F7]">
          Recomendaciones para lograr latencia imperceptible en video
        </h2>
        <ul className="space-y-2 text-sm text-[#9CA3AF] list-disc list-inside leading-relaxed">
          <li>
            Conecta tanto la laptop como el smartphone a la banda <strong className="text-[#F4F5F7]">Wi-Fi de 5 GHz</strong> (o conecta la laptop por cable Ethernet al router) para reducir el jitter de red por debajo de 4 ms.
          </li>
          <li>
            Selecciona el modo <strong className="text-[#F4F5F7]">Ultra-baja (15 ms)</strong> cuando veas películas o YouTube; usa <strong className="text-[#F4F5F7]">Equilibrada (40 ms)</strong> si escuchas música caminando por la casa.
          </li>
          <li>
            En Android, desactiva la optimización agresiva de batería para Chrome si escuchas con la pantalla apagada durante sesiones largas.
          </li>
        </ul>
      </section>
    </div>
  );
}
