if (window._teamsTranscriptLoaded) { /* already initialized */ }
else {
window._teamsTranscriptLoaded = true;

console.log('🔵 Content script loaded!', window.location.href);
console.log('Is iframe?', window.self !== window.top);

function buildMonthMap() {
  const map = {};
  for (let m = 0; m < 12; m++) {
    const name = new Date(2000, m, 1).toLocaleString('en-US', { month: 'long' });
    map[name] = String(m + 1).padStart(2, '0');
  }
  return map;
}
const MONTH_NAME_TO_NUMBER = buildMonthMap();

// ========== 親ページ（teams.microsoft.com / teams.cloud.microsoft）用 ==========
if (window.self === window.top) {

  function sendWithRetry(msg, retries = 2) {
    return chrome.runtime.sendMessage(msg).catch(err => {
      if (retries > 0) {
        console.warn(`[content] sendMessage failed, retrying (${retries} left):`, err.message);
        return new Promise(r => setTimeout(r, 500)).then(() => sendWithRetry(msg, retries - 1));
      }
      console.error('[content] sendMessage failed after retries:', err);
      throw err;
    });
  }

  // background service worker からのメッセージを受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_SCRAPING') {
      console.log('Starting scraping process...');

      // ミーティングタイトルを取得
      let meetingTitle = 'Teams Meeting';
      const titleSpan = document.querySelector('[data-tid="chat-title"] span[title]');
      if (titleSpan) {
        meetingTitle = titleSpan.getAttribute('title') || titleSpan.innerText.trim() || meetingTitle;
      }

      // 日付・時間を取得
      let meetingDate = '';
      let meetingDateFormatted = '';
      const dateEl = document.querySelector('[data-tid="intelligent-recap-header"] span');
      if (dateEl) {
        const dateText = dateEl.innerText.trim();
        meetingDate = dateText;
        // "Friday, February 6, 2026 11:30 AM -  12:00 PM"
        const dateMatch = dateText.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
        if (dateMatch) {
          const monthName = dateMatch[1];
          const day = dateMatch[2].padStart(2, '0');
          const year = dateMatch[3];
          const month = MONTH_NAME_TO_NUMBER[monthName];
          if (!month) {
            console.warn('[content] Unrecognized month name:', monthName, '— defaulting to raw date text');
          } else {
            meetingDateFormatted = `${year}${month}${day}`;
          }
        }
      }

      console.log('Meeting info:', { title: meetingTitle, date: meetingDate, formatted: meetingDateFormatted });

      // ミーティング情報を保存
      window._meetingInfo = {
        title: meetingTitle,
        date: meetingDate,
        dateFormatted: meetingDateFormatted
      };

      // iframe にメッセージを送信
      const iframe = document.getElementById('xplatIframe');
      if (iframe && iframe.contentWindow) {
        let targetOrigin;
        try {
          targetOrigin = new URL(iframe.src).origin;
        } catch (err) {
          console.error('[content] Failed to parse iframe origin, aborting:', iframe.src, err);
          sendResponse({ success: false, error: 'Could not determine iframe origin' });
          return true;
        }
        iframe.contentWindow.postMessage({ type: 'START_SCRAPING_IFRAME' }, targetOrigin);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Iframe not found.' });
      }
      return true;
    }
  });

  // iframe からのメッセージを受信
  window.addEventListener('message', (event) => {
    if (!event.data || !event.data.type) return;
    const iframe = document.getElementById('xplatIframe');
    if (!iframe || event.source !== iframe.contentWindow) return;

    if (event.data.type === 'TRANSCRIPT_COLLECTED') {
      console.log('✅ Transcript received:', event.data.itemCount, 'items');
      if (!window._meetingInfo) {
        console.warn('[content] window._meetingInfo not set, using defaults. Race condition possible.');
      }
      const meetingInfo = window._meetingInfo || { title: 'Teams Meeting (metadata unavailable)', date: '', dateFormatted: '' };
      const lines = [];

      lines.push(`# ${meetingInfo.title}`);
      lines.push('');
      if (meetingInfo.date) {
        lines.push(`Date: ${meetingInfo.date}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
      lines.push('## Transcript');
      lines.push('');

      const transcriptData = event.data.transcriptData;
      if (!Array.isArray(transcriptData)) {
        console.error('[content] transcriptData is not an array:', typeof transcriptData);
        sendWithRetry({ action: 'SCRAPING_ERROR', error: 'Invalid transcript data received from iframe' }).catch(err => { console.error('[content] Could not report invalid transcript data to background:', err); });
        return;
      }
      transcriptData.forEach(item => {
        if (!item || typeof item !== 'object') return;
        lines.push(`### ${String(item.speaker || 'Unknown')} — ${String(item.timestamp || '?')}`);
        lines.push('');
        lines.push(String(item.text || ''));
        lines.push('');
      });

      const markdown = lines.join('\n');

      sendWithRetry({
        action: 'TRANSCRIPT_READY',
        transcript: markdown,
        itemCount: event.data.itemCount,
        length: markdown.length,
        dateFormatted: meetingInfo.dateFormatted
      }).catch(err => {
        console.error('[content] Failed to deliver TRANSCRIPT_READY after retries:', err);
        chrome.runtime.sendMessage({
          action: 'SCRAPING_ERROR',
          error: 'Transcript collected but failed to send to background: ' + err.message
        }).catch(err2 => console.warn('[content] Last-resort SCRAPING_ERROR also failed:', err2.message));
      });
    } else if (event.data.type === 'SCRAPING_ERROR') {
      console.error('Scraping error:', event.data.error);
      sendWithRetry({
        action: 'SCRAPING_ERROR',
        error: event.data.error
      }).catch(err => {
        console.error('[content] Failed to deliver SCRAPING_ERROR after retries:', err);
        chrome.runtime.sendMessage({
          action: 'SCRAPING_ERROR',
          error: 'Original: ' + event.data.error + '. Relay failed: ' + err.message
        }).catch(err2 => console.warn('[content] Last-resort SCRAPING_ERROR also failed:', err2.message));
      });
    }
  });
}


// ========== iframe 用 ==========
if (window.self !== window.top) {
  console.log('🟢 Running inside iframe:', window.location.href);

  window.addEventListener('message', async (event) => {
    if (!event.data || !event.data.type) return;
    if (event.origin !== 'https://teams.microsoft.com'
        && !(event.origin.startsWith('https://') && event.origin.endsWith('.teams.microsoft.com'))
        && event.origin !== 'https://teams.cloud.microsoft'
        && !(event.origin.startsWith('https://') && event.origin.endsWith('.teams.cloud.microsoft'))) return;

    if (event.data.type === 'START_SCRAPING_IFRAME') {
      console.log('🟢 Received scraping request in iframe');
      const parentOrigin = event.origin;

      try {
        const transcriptData = [];
        const seenTexts = new Set();

        // スクロールコンテナを探す
        const scrollContainer = document.querySelector('[class*="focusZoneWithAutoScroll"]');

        if (!scrollContainer) {
          throw new Error('Scroll container not found');
        }

        console.log('Found scroll container');

        // 最初にトップにスクロール
        scrollContainer.scrollTop = 0;
        await new Promise(r => setTimeout(r, 500));

        let lastScrollTop = -1;
        let noChangeCount = 0;
        let skippedCount = 0;

        // スクロールしながら収集
        while (noChangeCount < 5) {
          // 少し待ってレンダリングを待つ
          await new Promise(r => setTimeout(r, 500));

          // 現在表示されているセルを収集
          const cells = document.querySelectorAll('.ms-List-cell');

          cells.forEach(cell => {
            const text = cell.innerText?.trim() || '';
            if (text && !seenTexts.has(text) && text.length > 5 && !text.includes('started transcription')) {
              seenTexts.add(text);

              const lines = text.split('\n').filter(l => l.trim());

              if (lines.length >= 2) {
                let speaker, timestamp = '', content;

                if (lines.length >= 5) {
                  // Legacy 5-line format: Speaker / RelTime / AbsTime / Label / Text...
                  speaker = lines[0];
                  timestamp = lines[2];
                  content = lines.slice(4).join(' ');
                } else {
                  // Compact format (2-4 lines)
                  // Line 1: "Speaker Name [relative-time]" e.g. "Mitsuki Fukunaga 3 minutes 29 seconds"
                  // Remaining: text content (may include timestamp lines to filter)
                  speaker = lines[0]
                    .replace(/\s+(\d+\s+(seconds?|minutes?|hours?)\s*)+$/i, '')
                    .trim();

                  // Look for absolute timestamp (H:MM) in text
                  const tsMatch = text.match(/(?:^|\n)(\d{1,2}:\d{2})(?:\n|$)/);
                  if (tsMatch) timestamp = tsMatch[1];

                  const contentLines = lines.slice(1).filter(l => {
                    const t = l.trim();
                    return !/^\d{1,2}:\d{2}$/.test(t) &&
                           !/^(\d+\s+(seconds?|minutes?|hours?)\s*)+$/i.test(t);
                  });
                  content = contentLines.join(' ');
                }

                if (speaker && content) {
                  transcriptData.push({ speaker, timestamp, text: content });
                }
              } else if (lines.length <= 1) {
                // Single-line or empty cell (speaker header, whitespace-only) — skip silently
              } else {
                console.warn('[iframe] Unexpected cell format, lines:', lines.length, cell.innerText?.slice(0, 80));
                skippedCount++;
              }
            }
          });

          console.log(`Collected ${transcriptData.length} items, scrollTop: ${scrollContainer.scrollTop}`);

          // スクロールダウン
          scrollContainer.scrollTop += 300;
          await new Promise(r => setTimeout(r, 300));

          // スクロール位置が変わったかチェック
          if (scrollContainer.scrollTop === lastScrollTop) {
            noChangeCount++;
          } else {
            noChangeCount = 0;
          }
          lastScrollTop = scrollContainer.scrollTop;
        }

        console.log('🟢 Scraping complete:', transcriptData.length, 'items,', skippedCount, 'skipped');

        // 親ウィンドウに結果を送信
        if (transcriptData.length === 0) {
          const totalCells = document.querySelectorAll('.ms-List-cell').length;
          window.parent.postMessage({ type: 'SCRAPING_ERROR', error: `No transcript items found. Total cells seen: ${totalCells}, skipped: ${skippedCount}` }, parentOrigin);
          return;
        }
        window.parent.postMessage({
          type: 'TRANSCRIPT_COLLECTED',
          transcriptData: transcriptData,
          itemCount: transcriptData.length
        }, parentOrigin);

      } catch (error) {
        console.error('Scraping error:', error);
        window.parent.postMessage({
          type: 'SCRAPING_ERROR',
          error: (error && error.message) || String(error)
        }, parentOrigin);
      }
    }
  });
}

} // end guard