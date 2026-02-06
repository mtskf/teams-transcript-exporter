// Handle transcript download in service worker (survives popup close)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'TRANSCRIPT_READY') {
    const now = new Date();
    const dateStr = message.dateFormatted || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `transcript_${dateStr}.md`;

    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(message.transcript);
    chrome.downloads.download({ url: dataUrl, filename });
  }
});
