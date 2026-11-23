import {
  Bluetooth,
  Headphones,
  Radio,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { ReceiverStatus } from '../hooks/useAudioReceiver';
import {
  formatRoomCode,
  LATENCY_PRESETS,
  LatencyPresetId,
  normalizeRoomCode,
} from '../lib/bridgeProtocol';
import { WaveformCanvas } from './WaveformCanvas';

interface ReceiverViewProps {
  status: ReceiverStatus;
  deviceName: string;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  onChangeRoomCode: (code: string) => void;
  onChangeDeviceName: (name: string) => void;
  onConnect: (codeOverride?: string) => void;
  onDisconnect: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onSelectLatencyPreset: (preset: LatencyPresetId) => void;
}

export function ReceiverView({
  status,
  deviceName,
  analyserRef,
  onChangeRoomCode,
  onChangeDeviceName,
  onConnect,
  onDisconnect,
  onChangeVolume,
  onToggleMute,
  onSelectLatencyPreset,
}: ReceiverViewProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status.connected) {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 pb-24 sm:px-6 lg:py-8 md:pb-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F5F7] sm:text-3xl text-balance">
            Receptor Móvil para Audífonos Bluetooth
          </h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Conecta tus audífonos inalámbricos al smartphone y recibe el audio de tu navegador por Wi-Fi.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
          {status.connected && (
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                status.senderConnected ? 'bg-[#10B981]' : 'bg-[#0EA5E9]'
              }`}
            />
          )}
          <span data-testid="receiver-connection-status">
            {status.connected
              ? status.senderConnected
                ? 'Enlazado con la laptop'
                : 'Esperando al emisor'
              : 'Desconectado'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Pairing Form & Bluetooth Output Card */}
        <section
          aria-labelledby="receiver-pair-heading"
          className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#13171D] p-5 sm:p-6 space-y-5"
        >
          <h2 id="receiver-pair-heading" className="font-display text-lg font-semibold text-[#F4F5F7]">
            Conectar a Sala Wi-Fi
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="receiver-room-input" className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">
                Código de sala de 6 caracteres
              </label>
              <input
                id="receiver-room-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                maxLength={7}
                placeholder="WVB492"
                value={status.roomCode}
                onChange={(e) => onChangeRoomCode(normalizeRoomCode(e.target.value))}
                disabled={status.connected}
                className="w-full min-h-[48px] rounded-xl border border-white/15 bg-[#0B0D10] px-4 py-2.5 font-mono text-xl font-semibold tracking-[0.18em] text-[#F4F5F7] uppercase placeholder:text-[#4B5563] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
              />
            </div>

            <div>
              <label htmlFor="receiver-device-input" className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">
                Nombre de este dispositivo
              </label>
              <input
                id="receiver-device-input"
                type="text"
                maxLength={40}
                value={deviceName}
                onChange={(e) => onChangeDeviceName(e.target.value)}
                disabled={status.connected}
                className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#0B0D10] px-3.5 py-2 text-sm text-[#F4F5F7] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
              />
            </div>

            {status.error && (
              <div
                role="alert"
                className="rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/10 px-3.5 py-2.5 text-xs text-[#FCA5A5]"
              >
                {status.error}
              </div>
            )}

            <button
              type="submit"
              disabled={status.connecting}
              className={`w-full min-h-[48px] rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                status.connected
                  ? 'bg-[#DC2626] text-white hover:bg-[#EF4444]'
                  : 'bg-[#0EA5E9] text-[#06121A] hover:bg-[#38BDF8]'
              }`}
            >
              {status.connecting
                ? 'Conectando...'
                : status.connected
                  ? 'Desconectar receptor'
                  : 'Conectar al emisor'}
            </button>
          </form>

          {/* Bluetooth Audio Routing Guide */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <div className="flex items-start gap-3">
              <Bluetooth className="mt-0.5 h-4 w-4 text-[#0EA5E9] shrink-0" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-[#F4F5F7]">
                  Salida Bluetooth del Smartphone
                </div>
                <p className="mt-0.5 text-xs text-[#9CA3AF] leading-relaxed">
                  Android dirige automáticamente el audio de esta sesión hacia tus audífonos inalámbricos emparejados. Los botones de pausa de tus cascos funcionan mediante MediaSession.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-[#9CA3AF] pt-1">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" aria-hidden="true" />
                Pantalla activa (WakeLock)
              </span>
              <span className="font-mono text-[#F4F5F7]">
                {status.wakeLockActive ? 'Activo' : 'Estándar'}
              </span>
            </div>
          </div>
        </section>

        {/* Live Reception Monitor & Thumb-Zone Audio Controls */}
        <section
          aria-labelledby="receiver-monitor-heading"
          className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#13171D] p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Headphones className="h-5 w-5 text-[#0EA5E9]" aria-hidden="true" />
              <div>
                <h2 id="receiver-monitor-heading" className="font-display text-lg font-semibold text-[#F4F5F7]">
                  {status.streamMetadata?.active
                    ? status.streamMetadata.sourceLabel
                    : status.connected
                      ? `Sala ${formatRoomCode(status.roomCode)} lista`
                      : 'Monitor de Recepción'}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF]">
                  <span>
                    {status.senderDeviceName
                      ? `Emisor: ${status.senderDeviceName}`
                      : 'Sin emisor activo'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {status.transportMode === 'webrtc'
                      ? 'WebRTC Opus'
                      : status.transportMode === 'websocket'
                        ? 'WebSocket PCM'
                        : 'En espera'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Real Measured Network & Audio Telemetry Row */}
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-white/10 bg-[#0B0D10] p-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
                <Wifi className="h-3 w-3" aria-hidden="true" />
                <span>Latencia RTT</span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[#F4F5F7] tabular-nums">
                {status.rttMs !== null ? `${status.rttMs} ms` : '—'}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
                <Radio className="h-3 w-3" aria-hidden="true" />
                <span>Jitter Wi-Fi</span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[#F4F5F7] tabular-nums">
                {status.connected ? `${status.jitterMs} ms` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#9CA3AF]">Paquetes WS</div>
              <div className="mt-1 font-mono text-lg font-semibold text-[#F4F5F7] tabular-nums">
                {status.packetsReceived}
              </div>
            </div>
          </div>

          {/* Live Incoming Signal Visualizer */}
          <WaveformCanvas
            analyserRef={analyserRef}
            active={status.connected && Boolean(status.streamMetadata?.active)}
            muted={status.muted}
            label="Audio recibido hacia audífonos Bluetooth"
          />

          {/* Buffer Preset */}
          <div>
            <div className="mb-2 text-xs font-medium text-[#9CA3AF]">
              Buffer anti-cortes en smartphone
            </div>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-[#0B0D10] p-1">
              {(Object.keys(LATENCY_PRESETS) as LatencyPresetId[]).map((id) => {
                const preset = LATENCY_PRESETS[id];
                const active = status.latencyPreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectLatencyPreset(id)}
                    className={`flex min-h-[46px] flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center transition-colors ${
                      active
                        ? 'bg-[#1F2937] text-[#F4F5F7]'
                        : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
                    }`}
                  >
                    <span className="text-xs font-medium leading-tight">{preset.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-[#38BDF8] leading-tight mt-0.5">
                      {preset.targetLatencyMs} ms
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ergonomic Volume & Mute Controls */}
          <div className="border-t border-white/10 pt-4 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="receiver-volume" className="font-medium text-[#9CA3AF]">
                Volumen en audífonos
              </label>
              <span className="font-mono tabular-nums text-[#F4F5F7]">
                {status.muted ? 'SILENCIADO' : `${Math.round(status.volume * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={status.muted ? 'Activar audio en audífonos' : 'Silenciar audífonos'}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-[#0B0D10] text-[#F4F5F7] hover:border-white/30"
              >
                {status.muted ? (
                  <VolumeX className="h-5 w-5 text-[#F59E0B]" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-5 w-5 text-[#0EA5E9]" aria-hidden="true" />
                )}
              </button>
              <input
                id="receiver-volume"
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={status.volume}
                onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                className="studio-slider w-full"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
