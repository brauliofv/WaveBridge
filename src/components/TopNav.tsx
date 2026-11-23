import { Headphones, Laptop, Puzzle, Network } from 'lucide-react';

export type AppView = 'sender' | 'receiver' | 'extension' | 'guide';

interface TopNavProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  streaming: boolean;
  receiverConnected: boolean;
}

const NAV_ITEMS: { id: AppView; label: string; mobileLabel: string; icon: typeof Laptop }[] = [
  { id: 'sender', label: 'Emisor PC', mobileLabel: 'Emisor', icon: Laptop },
  { id: 'receiver', label: 'Receptor Móvil', mobileLabel: 'Receptor', icon: Headphones },
  { id: 'extension', label: 'Extensión Chrome', mobileLabel: 'Extensión', icon: Puzzle },
  { id: 'guide', label: 'Arquitectura', mobileLabel: 'Guía', icon: Network },
];

export function TopNav({
  activeView,
  onSelectView,
  streaming,
  receiverConnected,
}: TopNavProps) {
  const isLive = streaming || receiverConnected;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0D10]/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-element Brand wordmark */}
          <button
            type="button"
            onClick={() => onSelectView('sender')}
            className="font-display text-lg font-bold tracking-tight text-[#F4F5F7] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] rounded-md px-1"
          >
            WaveBridge
          </button>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav aria-label="Navegación principal" className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectView(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] rounded-sm ${
                    active
                      ? 'text-[#F4F5F7]'
                      : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[17px] h-[2px] bg-[#0EA5E9]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single primary action button */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onSelectView(activeView === 'receiver' ? 'sender' : 'receiver')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-[#06121A] transition-colors hover:bg-[#38BDF8] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {isLive && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-[#06121A]"
                />
              )}
              {activeView === 'receiver' ? 'Ir al Emisor PC' : 'Abrir Receptor'}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar (under 15% sticky height cap) */}
      <nav
        aria-label="Navegación móvil"
        className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 border-t border-white/10 bg-[#0B0D10]/95 backdrop-blur-md md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors ${
                active ? 'text-[#0EA5E9]' : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate max-w-full">{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
