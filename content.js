console.log('🔵 Content script loaded!', window.location.href);
console.log('Is iframe?', window.self !== window.top);


// ========== 親ページ（teams.microsoft.com）用 ==========
if (window.self === window.top) {

  const NEWLINE = String.fromCharCode(10);

  // popup からのメッセージを受信
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
          const months = {
            'January': '01', 'February': '02', 'March': '03', 'April': '04',
            'May': '05', 'June': '06', 'July': '07', 'August': '08',
            'September': '09', 'October': '10', 'November': '11', 'December': '12'
          };
          const month = months[monthName] || '01';
          meetingDateFormatted = `${year}${month}${day}`;
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
        iframe.contentWindow.postMessage({ type: 'START_SCRAPING_IFRAME' }, '*');
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

    if (event.data.type === 'TRANSCRIPT_COLLECTED') {
      console.log('✅ Transcript received:', event.data.itemCount, 'items');

      const NEWLINE = String.fromCharCode(10);
      const meetingInfo = window._meetingInfo || { title: 'Teams Meeting', date: '', dateFormatted: '' };
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

      event.data.transcriptData.forEach(item => {
        lines.push(`### ${item.speaker} — ${item.timestamp}`);
        lines.push('');
        lines.push(item.text);
        lines.push('');
      });

      const markdown = lines.join(NEWLINE);

      chrome.runtime.sendMessage({
        action: 'TRANSCRIPT_READY',
        transcript: markdown,
        itemCount: event.data.itemCount,
        length: markdown.length,
        dateFormatted: meetingInfo.dateFormatted
      });
    } else if (event.data.type === 'SCRAPING_ERROR') {
      console.error('Scraping error:', event.data.error);
      chrome.runtime.sendMessage({
        action: 'SCRAPING_ERROR',
        error: event.data.error
      });
    }
  });
}


// ========== iframe（sharepoint.com）用 ==========
if (window.self !== window.top) {
  console.log('🟢 Running inside iframe:', window.location.href);

  window.addEventListener('message', async (event) => {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'START_SCRAPING_IFRAME') {
      console.log('🟢 Received scraping request in iframe');

      try {
        const transcriptData = [];
        const seenTexts = new Set();
        const NEWLINE = String.fromCharCode(10);

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

              const lines = text.split(NEWLINE).filter(l => l.trim());

              // 形式: "Speaker名", "X minutes Y seconds", "X:XX", "Speaker名 X minutes Y seconds", "実際のテキスト"
              if (lines.length >= 5) {
                const speaker = lines[0];
                const timestamp = lines[2]; // "0:23" 形式
                const content = lines.slice(4).join(' '); // 5行目以降がテキスト

                if (speaker && content) {
                  transcriptData.push({ speaker, timestamp, text: content });
                }
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

        console.log('🟢 Scraping complete:', transcriptData.length, 'items');

        // 親ウィンドウに結果を送信
        window.parent.postMessage({
          type: 'TRANSCRIPT_COLLECTED',
          transcriptData: transcriptData,
          itemCount: transcriptData.length
        }, '*');

      } catch (error) {
        console.error('Scraping error:', error);
        window.parent.postMessage({
          type: 'SCRAPING_ERROR',
          error: error.message
        }, '*');
      }
    }
  });
}