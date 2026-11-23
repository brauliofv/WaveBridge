import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Headphones,
  Mic,
  MonitorSpeaker,
  Play,
  RefreshCw,
  Square,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { SenderStatus } from '../hooks/useAudioSender';
import {
  AudioSourceType,
  buildReceiverUrl,
  CODEC_PROFILES,
  CodecProfileId,
  formatRoomCode,
  LATENCY_PRESETS,
  LatencyPresetId,
} from '../lib/bridgeProtocol';
import { WaveformCanvas } from './WaveformCanvas';

interface SenderViewProps {
  status: SenderStatus;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  onSelectSource: (source: AudioSourceType) => void;
  onSelectCodec: (codec: CodecProfileId) => void;
  onSelectLatencyPreset: (preset: LatencyPresetId) => void;
  onChangeGain: (gain: number) => void;
  onToggleMute: () => void;
  onToggleMonitorLocally: () => void;
  onStartStreaming: (source?: AudioSourceType) => void;
  onStopStreaming: () => void;
  onRegenerateRoomCode: () => void;
  onOpenReceiverTab: (roomCode: string) => void;
}

export function SenderView({
  status,
  analyserRef,
  onSelectSource,
  onSelectCodec,
  onSelectLatencyPreset,
  onChangeGain,
  onToggleMute,
  onToggleMonitorLocally,
  onStartStreaming,
  onStopStreaming,
  onRegenerateRoomCode,
  onOpenReceiverTab,
}: SenderViewProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedField, setCopiedField] = useState<'code' | 'url' | null>(null);

  const receiverUrl =
    typeof window !== 'undefined'
      ? buildReceiverUrl(window.location.origin, status.roomCode)
      : '';

  useEffect(() => {
    if (!receiverUrl) return;
    let cancelled = false;
    QRCode.toDataURL(receiverUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: '#0B0D10',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receiverUrl]);

  const copyText = async (value: string, field: 'code' | 'url') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Fallback ignored
    }
  };

  const sources: { id: AudioSourceType; title: string; detail: string; icon: typeof MonitorSpeaker }[] = [
    {
      id: 'tab',
      title: 'Pestaña de Chrome',
      detail: 'YouTube, Spotify Web, Netflix o cualquier pestaña con audio',
      icon: MonitorSpeaker,
    },
    {
      id: 'synth',
      title: 'Generador de Prueba',
      detail: 'Señal estéreo continua para probar latencia y Bluetooth al instante',
      icon: Waves,
    },
    {
      id: 'mic',
      title: 'Micrófono / Línea',
      detail: 'Entrada de micrófono o interfaz de audio conectada a la laptop',
      icon: Mic,
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-5 pb-24 sm:px-6 lg:py-6 md:pb-8">
      {/* Editorial Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F5F7] sm:text-3xl text-balance">
            Emisor de Audio Wi-Fi desde el Navegador
          </h1>
          <p className="mt-1 text-sm text-[#9CA3AF] max-w-2xl">
            Captura el sonido de tu laptop sin Bluetooth y envíalo en tiempo real por Wi-Fi a tu smartphone Android con audífonos inalámbricos.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
          {status.wsConnected && (
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#10B981]" />
          )}
          <span>{status.wsConnected ? 'Puente Wi-Fi activo' : 'Conectando puente'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{status.sampleRate / 1000} kHz</span>
        </div>
      </div>

      {/* Main 2-Column Studio Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* Left Column: Pairing & Connected Smartphone Devices */}
        <section
          aria-labelledby="pairing-heading"
          className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#13171D] p-5 space-y-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="pairing-heading" className="font-display text-lg font-semibold text-[#F4F5F7]">
                Emparejamiento con Smartphone
              </h2>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Escanea el QR o ingresa el código en tu teléfono Android.
              </p>
            </div>
            <button
              type="button"
              onClick={onRegenerateRoomCode}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D10] px-3 py-1.5 text-xs font-medium text-[#F4F5F7] transition-colors hover:border-white/25 whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Nuevo código
            </button>
          </div>

          {/* Code + QR Display */}
          <div className="flex flex-col sm:flex-row items-center gap-5 border-y border-white/10 py-5">
            <div className="shrink-0 rounded-xl bg-white p-2.5">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Código QR para conectar a la sala ${formatRoomCode(status.roomCode)}`}
                  referrerPolicy="no-referrer"
                  className="h-32 w-32 block"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center bg-slate-100 text-xs text-slate-600">
                  Generando QR...
                </div>
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="text-xs text-[#9CA3AF]">Código de sala</div>
              <div
                data-testid="room-code-display"
                className="mt-1 font-mono text-3xl font-semibold tracking-wider text-[#F4F5F7] tabular-nums"
              >
                {formatRoomCode(status.roomCode)}
              </div>

              <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={() => copyText(status.roomCode, 'code')}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D10] px-3 py-1.5 text-xs font-medium text-[#F4F5F7] hover:border-white/25 whitespace-nowrap"
                >
                  {copiedField === 'code' ? (
                    <Check className="h-3.5 w-3.5 text-[#10B981]" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copiedField === 'code' ? 'Copiado' : 'Copiar código'}
                </button>
                <button
                  type="button"
                  onClick={() => copyText(receiverUrl, 'url')}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D10] px-3 py-1.5 text-xs font-medium text-[#F4F5F7] hover:border-white/25 whitespace-nowrap"
                >
                  {copiedField === 'url' ? (
                    <Check className="h-3.5 w-3.5 text-[#10B981]" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copiedField === 'url' ? 'Enlace copiado' : 'Copiar enlace'}
                </button>
              </div>
            </div>
          </div>

          {/* Connected Receivers List */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F4F5F7]">
                Smartphones conectados ({status.receivers.length})
              </h3>
              <button
                type="button"
                onClick={() => onOpenReceiverTab(status.roomCode)}
                className="text-xs font-medium text-[#0EA5E9] hover:text-[#38BDF8] whitespace-nowrap"
              >
                Probar receptor aquí
              </button>
            </div>

            {status.receivers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 bg-[#0B0D10]/70 p-4 text-xs text-[#9CA3AF] leading-relaxed">
                Ningún smartphone conectado todavía. Abre el receptor en tu Android escaneando el QR y conecta tus audífonos Bluetooth al teléfono.
              </div>
            ) : (
              <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#0B0D10]">
                {status.receivers.map((rec) => (
                  <li key={rec.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Headphones className="h-4 w-4 text-[#10B981] shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[#F4F5F7]">
                          {rec.deviceName}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                          <span>{rec.transportMode === 'webrtc' ? 'WebRTC Opus' : rec.transportMode === 'websocket' ? 'WebSocket PCM' : 'Negociando'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {rec.rttMs !== null ? `${rec.rttMs} ms` : 'Midendo RTT'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#10B981] shrink-0">En línea</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Right Column: Audio Capture, Visualizer & Latency Controls */}
        <section
          aria-labelledby="audio-console-heading"
          className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#13171D] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="audio-console-heading" className="font-display text-lg font-semibold text-[#F4F5F7]">
                Consola de Transmisión
              </h2>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">
                Selecciona la fuente de audio y ajusta el buffer de latencia Wi-Fi.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {status.streaming && (
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#10B981]" />
              )}
              <span
                data-testid="sender-stream-status"
                className={status.streaming ? 'font-semibold text-[#10B981]' : 'text-[#9CA3AF]'}
              >
                {status.streaming ? 'Transmitiendo en vivo' : 'En espera'}
              </span>
            </div>
          </div>

          {/* Audio Source Selector */}
          <div>
            <div className="mb-2 text-xs font-medium text-[#9CA3AF]">Fuente de audio</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {sources.map((item) => {
                const Icon = item.icon;
                const selected = status.source === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectSource(item.id);
                      if (status.streaming) {
                        onStartStreaming(item.id);
                      }
                    }}
                    className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] ${
                      selected
                        ? 'border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#F4F5F7]'
                        : 'border-white/10 bg-[#0B0D10] text-[#9CA3AF] hover:border-white/25 hover:text-[#F4F5F7]'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 mb-2 ${selected ? 'text-[#0EA5E9]' : 'text-[#9CA3AF]'}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-semibold text-[#F4F5F7]">{item.title}</span>
                    <span className="mt-1 text-xs text-[#9CA3AF] leading-snug">{item.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Waveform Canvas */}
          <WaveformCanvas
            analyserRef={analyserRef}
            active={status.streaming}
            muted={status.muted}
            label={`Monitor de señal · ${status.sourceLabel}`}
          />

          {status.error && (
            <div
              role="alert"
              className="rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/10 px-4 py-3 text-xs text-[#FCA5A5]"
            >
              {status.error}
            </div>
          )}

          {/* Latency & Codec Controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-white/10 pt-4">
            <div>
              <div className="mb-2 text-xs font-medium text-[#9CA3AF]">Buffer de latencia Wi-Fi</div>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#0B0D10] p-1 border border-white/10">
                {(Object.keys(LATENCY_PRESETS) as LatencyPresetId[]).map((presetId) => {
                  const preset = LATENCY_PRESETS[presetId];
                  const active = status.latencyPreset === presetId;
                  return (
                    <button
                      key={presetId}
                      type="button"
                      onClick={() => onSelectLatencyPreset(presetId)}
                      className={`flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center transition-colors ${
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
              <p className="mt-1.5 text-xs text-[#9CA3AF]">
                {LATENCY_PRESETS[status.latencyPreset].description}
              </p>
            </div>

            <div>
              <label htmlFor="codec-select" className="mb-2 block text-xs font-medium text-[#9CA3AF]">
                Transporte y códec de audio
              </label>
              <select
                id="codec-select"
                value={status.codec}
                onChange={(e) => onSelectCodec(e.target.value as CodecProfileId)}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0D10] px-3 py-2 text-sm text-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
              >
                {(Object.keys(CODEC_PROFILES) as CodecProfileId[]).map((id) => (
                  <option key={id} value={id}>
                    {CODEC_PROFILES[id].label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-[#9CA3AF] font-mono tabular-nums">
                Tasa objetivo: {CODEC_PROFILES[status.codec].bitrateKbps} kbps · {status.sampleRate} Hz
              </p>
            </div>
          </div>

          {/* Gain Slider + Local Monitor + Primary Broadcast CTA */}
          <div className="flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:max-w-xs">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="sender-gain" className="font-medium text-[#9CA3AF]">
                  Ganancia de salida
                </label>
                <span className="font-mono tabular-nums text-[#F4F5F7]">
                  {status.muted ? '0%' : `${Math.round(status.gain * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={status.muted ? 'Activar sonido del emisor' : 'Silenciar emisor'}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#0B0D10] text-[#F4F5F7] hover:border-white/25"
                >
                  {status.muted ? (
                    <VolumeX className="h-4 w-4 text-[#F59E0B]" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <input
                  id="sender-gain"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={status.gain}
                  onChange={(e) => onChangeGain(parseFloat(e.target.value))}
                  className="studio-slider w-full"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-[#9CA3AF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={status.monitorLocally}
                  onChange={onToggleMonitorLocally}
                  className="h-4 w-4 rounded border-white/20 bg-[#0B0D10] accent-[#0EA5E9]"
                />
                <span>Escuchar monitor local en los altavoces de la laptop</span>
              </label>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {status.streaming ? (
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#DC2626] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#EF4444] whitespace-nowrap"
                >
                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                  Detener transmisión
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartStreaming()}
                  className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#0EA5E9] px-6 py-3 text-sm font-semibold text-[#06121A] transition-colors hover:bg-[#38BDF8] whitespace-nowrap"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  Iniciar transmisión
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
