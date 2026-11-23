import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChromeExtensionFiles } from './extensionBuilder';

test('buildChromeExtensionFiles produces valid MV3 manifest and offscreen files', () => {
  const files = buildChromeExtensionFiles('https://wavebridge.local:3000/');
  const paths = files.map((f) => f.path);

  assert.deepEqual(paths, [
    'manifest.json',
    'popup.html',
    'popup.js',
    'background.js',
    'offscreen.html',
    'offscreen.js',
  ]);

  const manifestFile = files.find((f) => f.path === 'manifest.json');
  assert.ok(manifestFile);
  const manifest = JSON.parse(manifestFile.content);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('tabCapture'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.deepEqual(manifest.host_permissions, ['https://wavebridge.local:3000/*']);

  const popupJs = files.find((f) => f.path === 'popup.js');
  assert.ok(popupJs?.content.includes('wss://wavebridge.local:3000/ws'));
});
