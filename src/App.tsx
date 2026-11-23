import { useEffect, useRef, useState } from 'react';
import { AppView, TopNav } from './components/TopNav';
import { SenderView } from './components/SenderView';
import { ReceiverView } from './components/ReceiverView';
import { ExtensionStudioView } from './components/ExtensionStudioView';
import { ArchitectureGuideView } from './components/ArchitectureGuideView';
import { DiagnosticDialog } from './components/DiagnosticDialog';
import { useAudioSender } from './hooks/useAudioSender';
import { useAudioReceiver } from './hooks/useAudioReceiver';
import { normalizeRoomCode } from './lib/bridgeProtocol';
import {
  APP_RELEASE_DATE,
  APP_VERSION,
  EXTENSION_RELEASE_DATE,
  EXTENSION_VERSION,
} from './lib/appMeta';
import { appendDiagnosticEntry, DiagnosticEntry } from './lib/diagnostics';

function getInitialRouteState(): { view: AppView; room: string } {
  if (typeof window === 'undefined') {
    return { view: 'sender', room: '' };
  }
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const room = normalizeRoomCode(params.get('room') || '');
  if (mode === 'receiver') {
    return { view: 'receiver', room };
  }
  if (mode === 'extension') {
    return { view: 'extension', room };
  }
  if (mode === 'guide') {
    return { view: 'guide', room };
  }
  return { view: 'sender', room };
}

export default function App() {
  const initial = getInitialRouteState();
  const [activeView, setActiveView] = useState<AppView>(initial.view);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnosticEntries, setDiagnosticEntries] = useState<DiagnosticEntry[]>([]);

  const sender = useAudioSender();
  const receiver = useAudioReceiver(initial.room);

  const lastSenderErrRef = useRef<string | null>(null);
  const lastReceiverErrRef = useRef<string | null>(null);

  // Capture unhandled runtime & promise errors automatically
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setDiagnosticEntries((prev) =>
        appendDiagnosticEntry(prev, {
          source: 'runtime',
          message: event.message || 'Error de ejecución en la interfaz',
          detail: event.filename ? `${event.filename}:${event.lineno}` : undefined,
        })
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason || 'Promesa rechazada');
      setDiagnosticEntries((prev) =>
        appendDiagnosticEntry(prev, {
          source: 'runtime',
          message: reason,
        })
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Capture sender & receiver errors cleanly
  useEffect(() => {
    if (sender.status.error && sender.status.error !== lastSenderErrRef.current) {
      lastSenderErrRef.current = sender.status.error;
      setDiagnosticEntries((prev) =>
        appendDiagnosticEntry(prev, {
          source: 'sender',
          message: sender.status.error!,
        })
      );
    } else if (!sender.status.error) {
      lastSenderErrRef.current = null;
    }
  }, [sender.status.error]);

  useEffect(() => {
    if (receiver.status.error && receiver.status.error !== lastReceiverErrRef.current) {
      lastReceiverErrRef.current = receiver.status.error;
      setDiagnosticEntries((prev) =>
        appendDiagnosticEntry(prev, {
          source: 'receiver',
          message: receiver.status.error!,
        })
      );
    } else if (!receiver.status.error) {
      lastReceiverErrRef.current = null;
    }
  }, [receiver.status.error]);

  // Sync URL query param lightly without reloading
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeView === 'sender') {
      url.searchParams.delete('mode');
      url.searchParams.delete('room');
    } else {
      url.searchParams.set('mode', activeView);
      if (activeView === 'receiver' && receiver.status.roomCode) {
        url.searchParams.set('room', receiver.status.roomCode);
      } else {
        url.searchParams.delete('room');
      }
    }
    window.history.replaceState({}, '', url.toString());
  }, [activeView, receiver.status.roomCode]);

  const handleOpenReceiverTab = (roomCode: string) => {
    receiver.setRoomCode(roomCode);
    setActiveView('receiver');
  };

  return (
    <div className="min-h-screen bg-[#0B0D10] text-[#F4F5F7] flex flex-col">
      <TopNav
        activeView={activeView}
        onSelectView={setActiveView}
        streaming={sender.status.streaming}
        receiverConnected={receiver.status.connected}
      />

      <main className="flex-1">
        {activeView === 'sender' && (
          <SenderView
            status={sender.status}
            analyserRef={sender.analyserRef}
            onSelectSource={sender.setSource}
            onSelectCodec={sender.setCodec}
            onSelectLatencyPreset={sender.setLatencyPreset}
            onChangeGain={sender.setGain}
            onToggleMute={() => sender.setMuted((m) => !m)}
            onToggleMonitorLocally={() => sender.setMonitorLocally((v) => !v)}
            onStartStreaming={sender.startStreaming}
            onStopStreaming={sender.stopStreaming}
            onRegenerateRoomCode={sender.regenerateRoomCode}
            onOpenReceiverTab={handleOpenReceiverTab}
          />
        )}

        {activeView === 'receiver' && (
          <ReceiverView
            status={receiver.status}
            deviceName={receiver.deviceName}
            analyserRef={receiver.analyserRef}
            onChangeRoomCode={receiver.setRoomCode}
            onChangeDeviceName={receiver.setDeviceName}
            onConnect={receiver.connect}
            onDisconnect={receiver.disconnect}
            onChangeVolume={receiver.setVolume}
            onToggleMute={() => receiver.setMuted((m) => !m)}
            onSelectLatencyPreset={receiver.setLatencyPreset}
          />
        )}

        {activeView === 'extension' && <ExtensionStudioView />}

        {activeView === 'guide' && <ArchitectureGuideView />}
      </main>

      <footer className="border-t border-white/5 px-4 py-3 pb-20 sm:px-6 md:pb-3">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 text-xs text-[#6B7280]">
          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
            <span>
              App v{APP_VERSION} · {APP_RELEASE_DATE}
            </span>
            <span aria-hidden="true">/</span>
            <span>
              Extensión v{EXTENSION_VERSION} · {EXTENSION_RELEASE_DATE}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setDiagnosticOpen(true)}
            className="text-xs text-[#9CA3AF] underline-offset-4 hover:text-[#F4F5F7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] rounded-sm px-1 py-0.5"
          >
            {diagnosticEntries.length > 0
              ? `Diagnóstico (${diagnosticEntries.length})`
              : 'Reportar error'}
          </button>
        </div>
      </footer>

      <DiagnosticDialog
        open={diagnosticOpen}
        onClose={() => setDiagnosticOpen(false)}
        activeView={activeView}
        roomCode={activeView === 'receiver' ? receiver.status.roomCode : sender.status.roomCode}
        wsConnected={sender.status.wsConnected}
        streaming={sender.status.streaming}
        receiverConnected={receiver.status.connected}
        entries={diagnosticEntries}
        onClearEntries={() => setDiagnosticEntries([])}
      />
    </div>
  );
}
