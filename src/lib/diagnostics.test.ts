import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_RELEASE_DATE, APP_VERSION, EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';
import {
  appendDiagnosticEntry,
  formatDiagnosticReport,
  MAX_DIAGNOSTIC_ENTRIES,
} from './diagnostics';

test('appendDiagnosticEntry bounds history to MAX_DIAGNOSTIC_ENTRIES', () => {
  let entries = [] as ReturnType<typeof appendDiagnosticEntry>;
  for (let i = 0; i < MAX_DIAGNOSTIC_ENTRIES + 5; i++) {
    entries = appendDiagnosticEntry(
      entries,
      { source: 'runtime', message: `Error ${i}` },
      new Date('2026-11-22T20:00:00.000Z')
    );
  }
  assert.equal(entries.length, MAX_DIAGNOSTIC_ENTRIES);
  assert.equal(entries[0].message, 'Error 5');
  assert.equal(entries[entries.length - 1].message, `Error ${MAX_DIAGNOSTIC_ENTRIES + 4}`);
});

test('formatDiagnosticReport formats version, date, state, and captured errors', () => {
  const entries = appendDiagnosticEntry(
    [],
    { source: 'sender', message: 'Permiso de pestaña denegado', detail: 'NotAllowedError' },
    new Date('2026-11-22T20:10:00.000Z')
  );

  const report = formatDiagnosticReport({
    activeView: 'sender',
    roomCode: 'WVB492',
    wsConnected: true,
    streaming: false,
    receiverConnected: false,
    userAgent: 'Chrome/131',
    entries,
    userNote: 'Falló al capturar YouTube',
  });

  assert.ok(report.includes(`App: v${APP_VERSION} (${APP_RELEASE_DATE})`));
  assert.ok(report.includes(`Extensión: v${EXTENSION_VERSION} (${EXTENSION_RELEASE_DATE})`));
  assert.ok(report.includes('Permiso de pestaña denegado'));
  assert.ok(report.includes('NotAllowedError'));
  assert.ok(report.includes('Falló al capturar YouTube'));
});
