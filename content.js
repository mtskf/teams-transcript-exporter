// Teams Transcript Exporter - Content Script
// Works with any Teams meeting Recap/Transcript
(function() {
  'use strict';

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handlers = {
      'getMeetingInfo': () => extractMeetingInfo(),
      'getParticipants': () => extractParticipants(),
      'extractTranscript': () => extractTranscript(),
      'scrollAndExtract': () => scrollAndExtractAll()
    };

    const handler = handlers[request.action];
    if (handler) {
      Promise.resolve(handler()).then(data => {
        sendResponse({ success: true, data });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
  });

  function extractMeetingInfo() {
    const info = { title: '', dateTime: '', url: window.location.href };

    // Find meeting title in headings
    const headings = document.querySelectorAll('h1, h2, [role="heading"]');
    for (const h of headings) {
      const text = h.innerText?.trim();
      if (text && text.length > 5 && 
          !['Chat', 'Content', 'Oops', 'Notes', 'Transcript', 'Recap'].includes(text)) {
        info.title = text;
        break;
      }
    }

    // Find date/time patterns
    const datePatterns = [
      /w+,s+w+s+d{1,2},s+d{4}s+d{1,2}:d{2}s*(AM|PM)s*-s*d{1,2}:d{2}s*(AM|PM)/i,
      /w+,s+w+s+d{1,2},s+d{4}/i
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          info.dateTime = match[0];
          break;
        }
      }
      if (info.dateTime) break;
    }

    return info;
  }

  function extractParticipants() {
    const participants = [];
    const seen = new Set();

    const selectors = ['[role="menuitem"]', '[role="listitem"]', '[class*="participant"]'];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(item => {
        const text = item.innerText?.trim();
        if (!text || /^(Add|Leave|Remove|People|d+$)/i.test(text)) return;

        const lines = text.split('
').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return;

        const name = lines[0];
        if (name.length < 2 || name.length > 50 || seen.has(name)) return;
        if (!/^[A-Za-z]/.test(name)) return;

        const participant = { name };
        const fullText = text.toLowerCase();
        if (fullText.includes('organizer')) participant.role = 'Organizer';
        if (fullText.includes('you')) participant.isCurrentUser = true;

        const statusImg = item.querySelector('img[alt]');
        if (statusImg) {
          const alt = statusImg.alt;
          if (['Available', 'Away', 'Busy', 'Offline', 'Out of office'].includes(alt)) {
            participant.status = alt;
          }
        }

        seen.add(name);
        participants.push(participant);
      });
    }

    return participants;
  }

  async function extractTranscript() {
    const entries = [];
    const seen = new Set();

    // Try multiple extraction strategies
    const results = [
      ...extractFromTextPatterns(),
      ...extractFromAriaLabels()
    ];

    for (const entry of results) {
      const key = entry.speaker + '|' + entry.timestamp + '|' + entry.text;
      if (!seen.has(key) && entry.text) {
        seen.add(key);
        entries.push(entry);
      }
    }

    entries.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
    return entries;
  }

  function extractFromTextPatterns() {
    const entries = [];
    const elements = document.querySelectorAll('div, p, span');
    
    for (const el of elements) {
      if (el.children.length > 5) continue;
      
      const text = el.innerText?.trim();
      if (!text || text.length > 2000 || text.length < 10) continue;

      const lines = text.split('
').map(l => l.trim()).filter(Boolean);
      
      let currentSpeaker = '';
      let currentTimestamp = '';
      let messageLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const speakerMatch = line.match(/^([A-Z][a-z]+(?:s+[A-Z][a-z'-]+)*)s+(d{1,2}:d{2}(?::d{2})?)$/);
        
        if (speakerMatch) {
          if (currentSpeaker && messageLines.length > 0) {
            entries.push({
              speaker: currentSpeaker,
              timestamp: currentTimestamp,
              text: messageLines.join(' ').trim()
            });
          }
          currentSpeaker = speakerMatch[1];
          currentTimestamp = speakerMatch[2];
          messageLines = [];
        } else if (currentSpeaker) {
          if (!line.includes('started transcription') && !line.includes('AI-generated') && !line.includes('Search')) {
            messageLines.push(line);
          }
        }
      }
      
      if (currentSpeaker && messageLines.length > 0) {
        entries.push({
          speaker: currentSpeaker,
          timestamp: currentTimestamp,
          text: messageLines.join(' ').trim()
        });
      }
    }

    return entries;
  }

  function extractFromAriaLabels() {
    const entries = [];
    document.querySelectorAll('[aria-label]').forEach(el => {
      const label = el.getAttribute('aria-label') || '';
      const match = label.match(/^([^,]+),s*(d{1,2}:d{2}(?::d{2})?),?s*(.*)$/);
      if (match && match[3]) {
        entries.push({
          speaker: match[1].trim(),
          timestamp: match[2].trim(),
          text: match[3].trim() || el.innerText?.trim() || ''
        });
      }
    });
    return entries;
  }

  async function scrollAndExtractAll() {
    const allEntries = [];
    const seen = new Set();
    const scrollContainers = findScrollableContainers();
    
    if (scrollContainers.length === 0) {
      return extractTranscript();
    }

    for (const container of scrollContainers) {
      container.scrollTop = 0;
      await sleep(300);
      
      let previousScrollTop = -1;
      let stuckCount = 0;
      
      for (let i = 0; i < 100; i++) {
        const currentEntries = await extractTranscript();
        for (const entry of currentEntries) {
          const key = entry.speaker + '|' + entry.timestamp + '|' + entry.text;
          if (!seen.has(key) && entry.text) {
            seen.add(key);
            allEntries.push(entry);
          }
        }
        
        container.scrollBy({ top: 400, behavior: 'smooth' });
        await sleep(400);
        
        if (Math.abs(container.scrollTop - previousScrollTop) < 10) {
          stuckCount++;
          if (stuckCount >= 3) break;
        } else {
          stuckCount = 0;
        }
        previousScrollTop = container.scrollTop;
      }
    }

    allEntries.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
    return allEntries;
  }

  function findScrollableContainers() {
    const containers = [];
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
        const text = el.innerText || '';
        if (/d{1,2}:d{2}/.test(text) && text.length > 100) {
          containers.push(el);
        }
      }
    });
    containers.sort((a, b) => a.scrollHeight - b.scrollHeight);
    return containers.slice(0, 3);
  }

  function parseTimestamp(ts) {
    if (!ts) return 0;
    const parts = ts.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  console.log('[Teams Transcript Exporter] Loaded');
})();