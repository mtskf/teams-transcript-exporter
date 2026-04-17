const ERROR_COLOR = '#d42020';
const PROGRESS_COLOR = '#0078d4';
const BADGE_DURATION_MS = 3000;

let _badgeTimer = null;

function showBadge(text, color, duration) {
  if (_badgeTimer) clearTimeout(_badgeTimer);
  chrome.action.setBadgeText({ text }).catch(err => console.warn('[background] badge:', err.message));
  chrome.action.setBadgeBackgroundColor({ color }).catch(err => console.warn('[background] badge:', err.message));
  _badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(err => console.warn('[background] badge:', err.message));
    _badgeTimer = null;
  }, duration);
}

function showError() {
  showBadge('!', ERROR_COLOR, BADGE_DURATION_MS);
}

const EXTRACTION_TIMEOUT_MS = 360000;
let extractingTabId = null;
let _extractionTimer = null;

function startExtractionTimeout() {
  _extractionTimer = setTimeout(() => failExtraction('Extraction timed out', `no response within ${EXTRACTION_TIMEOUT_MS / 1000}s`), EXTRACTION_TIMEOUT_MS);
}

function clearExtractionTimeout() {
  if (_extractionTimer) {
    clearTimeout(_extractionTimer);
    _extractionTimer = null;
  }
}

function failExtraction(reason, detail) {
  clearExtractionTimeout();
  console.error(`[background] ${reason}:`, detail);
  extractingTabId = null;
  showError();
}

function isTeamsUrl(url) {
  let hostname;
  try {
    hostname = new URL(url || '').hostname;
  } catch (err) {
    console.warn('[background] Failed to parse tab URL:', url, err);
    return false;
  }
  return hostname === 'teams.microsoft.com'
      || hostname.endsWith('.teams.microsoft.com')
      || hostname === 'teams.cloud.microsoft'
      || hostname.endsWith('.teams.cloud.microsoft');
}

chrome.action.onClicked.addListener(async (tab) => {
  if (extractingTabId !== null) return;

  if (!isTeamsUrl(tab.url)) {
    console.error('[background] Not a Teams page:', tab.url);
    showError();
    return;
  }

  extractingTabId = tab.id;
  startExtractionTimeout();
  chrome.action.setBadgeText({ text: '...' }).catch(err => console.warn('[background] badge:', err.message));
  chrome.action.setBadgeBackgroundColor({ color: PROGRESS_COLOR }).catch(err => console.warn('[background] badge:', err.message));

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js']
    });
    let response;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' });
        break;
      } catch (err) {
        if (attempt === 4) throw err;
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (response == null) {
      failExtraction('Content script did not respond', 'response was null/undefined — listener may not be registered');
    } else if (!response.success) {
      failExtraction('Content script error', response.error || 'no error detail provided');
    }
  } catch (err) {
    failExtraction('sendMessage failed', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.action === 'TRANSCRIPT_READY') {
    clearExtractionTimeout();
    extractingTabId = null;

    const transcript = message.transcript;
    if (!transcript) {
      console.error('[background] TRANSCRIPT_READY received with empty/missing transcript:', {
        transcript: typeof message.transcript,
        itemCount: message.itemCount,
        length: message.length,
      });
      showError();
      sendResponse({ received: true });
      return;
    }

    const now = new Date();
    const rawDate = message.dateFormatted;
    const dateStr = (typeof rawDate === 'string' && /^\d{8}$/.test(rawDate)) ? rawDate : `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `transcript_${dateStr}.md`;

    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(transcript);
    chrome.downloads.download({ url: dataUrl, filename }, () => {
      if (chrome.runtime.lastError) {
        failExtraction('Download failed', chrome.runtime.lastError.message);
        return;
      }
      chrome.action.setBadgeText({ text: '' }).catch(err => console.warn('[background] badge:', err.message));
    });
    sendResponse({ received: true });
  } else if (message.action === 'SCRAPING_ERROR') {
    failExtraction('Scraping error from content script', message.error);
    sendResponse({ received: true });
  } else {
    console.warn('[background] Unhandled message action:', message.action);
    sendResponse({ received: false, error: 'Unknown action' });
  }
});

// Reset extraction state when the extracting tab is closed or navigates away
function resetExtraction() {
  clearExtractionTimeout();
  extractingTabId = null;
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === extractingTabId) {
    console.log('[background] Extracting tab closed, resetting state');
    resetExtraction();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === extractingTabId && changeInfo.url && !isTeamsUrl(changeInfo.url)) {
    console.log('[background] Extracting tab navigated away from Teams, resetting state');
    resetExtraction();
  }
});
