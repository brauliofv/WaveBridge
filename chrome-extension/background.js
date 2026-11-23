async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC'],
      justification: 'Streaming de audio del navegador por WebRTC/WebSocket hacia el smartphone.',
    });
  }
}

async function appendErrorLog(message) {
  const data = await chrome.storage.local.get(['errorLogs']);
  const logs = Array.isArray(data.errorLogs) ? data.errorLogs : [];
  logs.push(`[${new Date().toISOString()}] ${message}`);
  await chrome.storage.local.set({ errorLogs: logs.slice(-15) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
        chrome.storage.local.set({ streaming: true });
        sendResponse({ ok: true });
      })
      .catch(async (err) => {
        await appendErrorLog(`offscreen: ${err?.message || String(err)}`);
        await chrome.storage.local.set({ streaming: false });
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg.type === 'STOP_CAPTURE' || msg.type === 'CAPTURE_ENDED') {
    if (msg.type === 'STOP_CAPTURE') {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    }
    chrome.storage.local.set({ streaming: false });
    sendResponse({ ok: true });
  }
  if (msg.type === 'LOG_ERROR' && msg.message) {
    appendErrorLog(String(msg.message));
  }
});
