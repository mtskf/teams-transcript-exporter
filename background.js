const ERROR_COLOR = '#d42020';
const PROGRESS_COLOR = '#0078d4';
const BADGE_DURATION_MS = 3000;

let _badgeTimer = null;

function showBadge(text, color, duration) {
  if (_badgeTimer) clearTimeout(_badgeTimer);
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  _badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    _badgeTimer = null;
  }, duration);
}

function showError() {
  showBadge('!', ERROR_COLOR, BADGE_DURATION_MS);
}

const EXTRACTION_TIMEOUT_MS = 60000;
let isExtracting = false;
let _extractionTimer = null;

function startExtractionTimeout() {
  _extractionTimer = setTimeout(() => failExtraction('Extraction timed out', 'no response within 60s'), EXTRACTION_TIMEOUT_MS);
}

function clearExtractionTimeout() {
  if (_extractionTimer) { clearTimeout(_extractionTimer); _extractionTimer = null; }
}

function failExtraction(reason, detail) {
  clearExtractionTimeout();
  console.error(`[background] ${reason}:`, detail);
  isExtracting = false;
  showError();
}

function isTeamsUrl(url) {
  let hostname;
  try { hostname = new URL(url || '').hostname; } catch { return false; }
  return hostname === 'teams.microsoft.com'
      || hostname.endsWith('.teams.microsoft.com')
      || hostname === 'teams.cloud.microsoft'
      || hostname.endsWith('.teams.cloud.microsoft');
}

chrome.action.onClicked.addListener(async (tab) => {
  if (isExtracting) return;

  if (!isTeamsUrl(tab.url)) {
    console.error('[background] Not a Teams page:', tab.url);
    showError();
    return;
  }

  isExtracting = true;
  startExtractionTimeout();
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: PROGRESS_COLOR });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js']
    });
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' });
    if (!response?.success) {
      failExtraction('Content script error', response?.error);
    }
  } catch (err) {
    failExtraction('sendMessage failed', err);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'TRANSCRIPT_READY') {
    clearExtractionTimeout();
    isExtracting = false;

    const transcript = message.transcript;
    if (!transcript) {
      showError();
      return;
    }

    const now = new Date();
    const dateStr = message.dateFormatted || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `transcript_${dateStr}.md`;

    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(transcript);
    chrome.downloads.download({ url: dataUrl, filename }, () => {
      if (chrome.runtime.lastError) {
        failExtraction('Download failed', chrome.runtime.lastError.message);
        return;
      }
      chrome.action.setBadgeText({ text: '' });
    });
  }

  if (message.action === 'SCRAPING_ERROR') {
    failExtraction('Scraping error from content script', message.error);
  }
});
