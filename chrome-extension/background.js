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

function notifyPopup(streaming, errorMessage = '') {
  chrome.runtime.sendMessage({
    type: 'STATUS_CHANGED',
    streaming,
    errorMessage,
  }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    ensureOffscreen()
      .then(() => {
        chrome.storage.local.set({ streaming: false, lastError: '' });
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
        sendResponse({ ok: true });
      })
      .catch(async (err) => {
        const errMsg = `offscreen: ${err?.message || String(err)}`;
        await appendErrorLog(errMsg);
        await chrome.storage.local.set({ streaming: false, lastError: errMsg });
        notifyPopup(false, errMsg);
        sendResponse({ ok: false });
      });
    return true;
  }

  if (msg.type === 'CAPTURE_CONNECTED') {
    chrome.storage.local.set({ streaming: true, lastError: '' });
    notifyPopup(true, '');
    return false;
  }

  if (msg.type === 'CAPTURE_RECONNECTING') {
    chrome.runtime.sendMessage({
      type: 'RECONNECT_STATUS',
      attempt: msg.attempt || 1,
      maxAttempts: msg.maxAttempts || 5,
    }).catch(() => undefined);
    return false;
  }

  if (msg.type === 'STOP_CAPTURE' || msg.type === 'CAPTURE_ENDED') {
    if (msg.type === 'STOP_CAPTURE') {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP', target: 'offscreen' });
    }
    const errMsg = msg.errorMessage ? String(msg.errorMessage) : '';
    chrome.storage.local.set({ streaming: false, lastError: errMsg });
    notifyPopup(false, errMsg);
    sendResponse({ ok: true });
  }

  if (msg.type === 'LOG_ERROR' && msg.message) {
    appendErrorLog(String(msg.message));
  }
});
