import { APP_RELEASE_DATE, APP_VERSION, EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  source: 'sender' | 'receiver' | 'runtime' | 'extension';
  message: string;
  detail?: string;
}

export const MAX_DIAGNOSTIC_ENTRIES = 25;

export function appendDiagnosticEntry(
  entries: DiagnosticEntry[],
  entry: Omit<DiagnosticEntry, 'id' | 'timestamp'>,
  now: Date = new Date()
): DiagnosticEntry[] {
  const next: DiagnosticEntry = {
    id: `${now.getTime()}-${entries.length}`,
    timestamp: now.toISOString(),
    source: entry.source,
    message: entry.message.trim(),
    detail: entry.detail?.trim() || undefined,
  };
  const updated = [...entries, next];
  if (updated.length > MAX_DIAGNOSTIC_ENTRIES) {
    return updated.slice(updated.length - MAX_DIAGNOSTIC_ENTRIES);
  }
  return updated;
}

export interface DiagnosticReportInput {
  activeView: string;
  roomCode: string;
  wsConnected: boolean;
  streaming: boolean;
  receiverConnected: boolean;
  userAgent: string;
  entries: DiagnosticEntry[];
  userNote?: string;
}

export function formatDiagnosticReport(input: DiagnosticReportInput): string {
  const lines: string[] = [
    '=== WaveBridge Diagnóstico ===',
    `App: v${APP_VERSION} (${APP_RELEASE_DATE})`,
    `Extensión: v${EXTENSION_VERSION} (${EXTENSION_RELEASE_DATE})`,
    `Vista activa: ${input.activeView}`,
    `Sala: ${input.roomCode || 'N/A'}`,
    `Puente WS emisor: ${input.wsConnected ? 'conectado' : 'desconectado'}`,
    `Transmitiendo: ${input.streaming ? 'sí' : 'no'}`,
    `Receptor conectado: ${input.receiverConnected ? 'sí' : 'no'}`,
    `Navegador / Sistema: ${input.userAgent || 'desconocido'}`,
  ];

  if (input.userNote?.trim()) {
    lines.push(`Nota del usuario: ${input.userNote.trim()}`);
  }

  lines.push('');
  if (input.entries.length === 0) {
    lines.push('Errores registrados: ninguno en esta sesión.');
  } else {
    lines.push(`Errores registrados (${input.entries.length}):`);
    for (const item of input.entries) {
      lines.push(`- [${item.timestamp}] (${item.source}) ${item.message}`);
      if (item.detail) {
        lines.push(`  Detalle: ${item.detail}`);
      }
    }
  }

  return lines.join('\n');
}
