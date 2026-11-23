import { useEffect, useState } from 'react';
import { AppView, TopNav } from './components/TopNav';
import { SenderView } from './components/SenderView';
import { ReceiverView } from './components/ReceiverView';
import { ExtensionStudioView } from './components/ExtensionStudioView';
import { ArchitectureGuideView } from './components/ArchitectureGuideView';
import { useAudioSender } from './hooks/useAudioSender';
import { useAudioReceiver } from './hooks/useAudioReceiver';
import { normalizeRoomCode } from './lib/bridgeProtocol';

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

  const sender = useAudioSender();
  const receiver = useAudioReceiver(initial.room);

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
    </div>
  );
}
