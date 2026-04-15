function showBadge(text, color, duration) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), duration);
}

chrome.action.onClicked.addListener(async (tab) => {
  const url = tab.url || '';
  if (!url.includes('teams.microsoft.com') && !url.includes('teams.cloud.microsoft')) {
    showBadge('!', '#d42020', 3000);
    return;
  }

  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#0078d4' });

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' });
  } catch {
    showBadge('!', '#d42020', 3000);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'TRANSCRIPT_READY') {
    const now = new Date();
    const dateStr = message.dateFormatted || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `transcript_${dateStr}.md`;

    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(message.transcript);
    chrome.downloads.download({ url: dataUrl, filename });
    chrome.action.setBadgeText({ text: '' });
  }

  if (message.action === 'SCRAPING_ERROR') {
    showBadge('!', '#d42020', 3000);
  }
});
