import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChromeExtensionFiles,
  resolveSafeDefaultBridgeOrigin,
} from './extensionBuilder';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from './appMeta';

test('resolveSafeDefaultBridgeOrigin restricts defaults strictly to local Wi-Fi addresses', () => {
  assert.equal(
    resolveSafeDefaultBridgeOrigin('https://ais-dev-abc123.us-west2.run.app/'),
    'http://localhost:3000'
  );
  assert.equal(
    resolveSafeDefaultBridgeOrigin('https://example.com/'),
    'http://localhost:3000'
  );
  assert.equal(
    resolveSafeDefaultBridgeOrigin('http://192.168.1.50:3000/'),
    'http://192.168.1.50:3000'
  );
});

test('buildChromeExtensionFiles produces local-only MV3 manifest and offscreen files', () => {
  const files = buildChromeExtensionFiles('http://192.168.1.50:3000/');
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
  assert.deepEqual(manifest.host_permissions, ['http://*/*']);

  const popupJs = files.find((f) => f.path === 'popup.js');
  assert.ok(popupJs?.content.includes("const DEFAULT_SERVER_URL = 'http://192.168.1.50:3000'"));
  assert.ok(popupJs?.content.includes('copyDiagBtn'));
  assert.ok(popupJs?.content.includes(EXTENSION_RELEASE_DATE));
  assert.ok(popupJs?.content.includes('/api/network-info'));

  const offscreenJs = files.find((f) => f.path === 'offscreen.js');
  assert.ok(offscreenJs?.content.includes('iceServers: []'));
  assert.ok(!offscreenJs?.content.includes('stun.l.google.com'));
});
