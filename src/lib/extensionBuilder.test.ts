import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChromeExtensionFiles,
  resolveSafeDefaultBridgeOrigin,
} from './extensionBuilder';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

test('resolveSafeDefaultBridgeOrigin avoids ais-dev proxy URLs for external extension clients', () => {
  assert.equal(
    resolveSafeDefaultBridgeOrigin('https://ais-dev-abc123.us-west2.run.app/'),
    'http://localhost:3000'
  );
  assert.equal(
    resolveSafeDefaultBridgeOrigin('https://wavebridge.local:3000/'),
    'https://wavebridge.local:3000'
  );
});

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
  assert.equal(manifest.version, EXTENSION_VERSION);
  assert.ok(manifest.permissions.includes('desktopCapture'));
  assert.ok(manifest.permissions.includes('tabCapture'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.host_permissions.includes('http://*/*'));
  assert.ok(manifest.host_permissions.includes('https://*/*'));

  const popupJs = files.find((f) => f.path === 'popup.js');
  assert.ok(popupJs?.content.includes("const DEFAULT_SERVER_URL = 'https://wavebridge.local:3000'"));
  assert.ok(popupJs?.content.includes('copyDiagBtn'));
  assert.ok(popupJs?.content.includes(EXTENSION_RELEASE_DATE));
  assert.ok(popupJs?.content.includes('/api/health'));
});
