document.getElementById('scrapeBtn').addEventListener('click', async () => {
  const button = document.getElementById('scrapeBtn');
  const status = document.getElementById('status');

  button.disabled = true;
  button.textContent = 'Extracting...';
  status.className = 'info';
  status.textContent = 'Searching for transcript...';

  try {
    // 現在のタブを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    console.log('Tab:', tab.id, tab.url);

    // Teams の Recap ページかチェック
    if (!tab.url.includes('teams.microsoft.com') && !tab.url.includes('teams.cloud.microsoft')) {
      throw new Error('Please open a Teams Recap page first');
    }

    // content script にメッセージを送信
    chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' }, (response) => {
      console.log('Response:', response);
      console.log('LastError:', chrome.runtime.lastError);

      if (chrome.runtime.lastError) {
        status.className = 'error';
        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
        button.disabled = false;
        button.textContent = 'Extract Transcript';
        return;
      }

      if (response && response.success) {
        status.className = 'info';
        status.textContent = 'Scraping in progress... This may take a minute.';
      } else if (response && response.error) {
        status.className = 'error';
        status.textContent = response.error;
        button.disabled = false;
        button.textContent = 'Extract Transcript';
      }
    });

  } catch (error) {
    status.className = 'error';
    status.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Extract Transcript';
  }
});

// transcript が収集されたときのメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const status = document.getElementById('status');
  const button = document.getElementById('scrapeBtn');

  if (message.action === 'TRANSCRIPT_READY') {
    status.className = 'success';
    status.textContent = `✓ Extracted ${message.itemCount} items (${message.length} chars)`;

    // ファイル名を生成
    const dateStr = message.dateFormatted || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `transcript_${dateStr}.md`;

    // Markdownファイルとしてダウンロード
    const blob = new Blob([message.transcript], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    button.disabled = false;
    button.textContent = 'Extract Transcript';
  } else if (message.action === 'SCRAPING_ERROR') {
    status.className = 'error';
    status.textContent = 'Error: ' + message.error;
    button.disabled = false;
    button.textContent = 'Extract Transcript';
  }
});