import { useState } from 'react';
import { Check, Copy, Trash2, X } from 'lucide-react';
import { DiagnosticEntry, formatDiagnosticReport } from '../lib/diagnostics';

interface DiagnosticDialogProps {
  open: boolean;
  onClose: () => void;
  activeView: string;
  roomCode: string;
  wsConnected: boolean;
  streaming: boolean;
  receiverConnected: boolean;
  entries: DiagnosticEntry[];
  onClearEntries: () => void;
}

export function DiagnosticDialog({
  open,
  onClose,
  activeView,
  roomCode,
  wsConnected,
  streaming,
  receiverConnected,
  entries,
  onClearEntries,
}: DiagnosticDialogProps) {
  const [userNote, setUserNote] = useState('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const reportText = formatDiagnosticReport({
    activeView,
    roomCode,
    wsConnected,
    streaming,
    receiverConnected,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'desconocido',
    entries,
    userNote,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-[#13171D] p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="diagnostic-dialog-title" className="font-display text-base font-semibold text-[#F4F5F7]">
            Diagnóstico y reporte de errores
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar diagnóstico"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#0B0D10] text-[#9CA3AF] hover:text-[#F4F5F7]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="text-xs text-[#9CA3AF]">
          Copia esta información técnica para compartir cualquier fallo detectado en tu sesión.
        </p>

        <div>
          <label htmlFor="diagnostic-note" className="mb-1 block text-xs font-medium text-[#9CA3AF]">
            Nota opcional (qué estabas haciendo)
          </label>
          <input
            id="diagnostic-note"
            type="text"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="Ej. Al pulsar transmitir pestaña..."
            className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0D10] px-3 py-2 text-xs text-[#F4F5F7] placeholder:text-[#4B5563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9]"
          />
        </div>

        <pre className="max-h-56 overflow-auto rounded-xl border border-white/10 bg-[#0B0D10] p-3 font-mono text-[11px] leading-relaxed text-[#D1D5DB] whitespace-pre-wrap">
          {reportText}
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onClearEntries}
            disabled={entries.length === 0}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D10] px-3 py-1.5 text-xs font-medium text-[#9CA3AF] hover:text-[#F4F5F7] disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Limpiar registro
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-[#06121A] hover:bg-[#38BDF8]"
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? 'Reporte copiado' : 'Copiar reporte'}
          </button>
        </div>
      </div>
    </div>
  );
}
