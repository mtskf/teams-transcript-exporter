// Teams Transcript Exporter - Popup Script
let extractedData = null;
let meetingInfo = null;
let participants = [];

document.addEventListener('DOMContentLoaded', async () => {
  const extractBtn = document.getElementById('extractBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');
  const entriesEl = document.getElementById('entries');
  const countEl = document.getElementById('count');
  const scrollToLoadCheckbox = document.getElementById('scrollToLoad');
  const includeTimestampsCheckbox = document.getElementById('includeTimestamps');
  const meetingInfoEl = document.getElementById('meetingInfo');
  const meetingTitleEl = document.getElementById('meetingTitle');
  const meetingDateTimeEl = document.getElementById('meetingDateTime');
  const participantsSectionEl = document.getElementById('participantsSection');
  const participantsListEl = document.getElementById('participantsList');
  const participantCountEl = document.getElementById('participantCount');

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  
  if (!tab.url?.includes('teams.microsoft.com')) {
    setStatus('Please open Microsoft Teams to use this extension.', 'error');
    extractBtn.disabled = true;
    return;
  }

  try {
    await injectContentScript(tab.id);
    
    const infoResponse = await sendMessage(tab.id, { action: 'getMeetingInfo' });
    if (infoResponse?.data) {
      meetingInfo = infoResponse.data;
      if (meetingInfo.title) {
        meetingTitleEl.textContent = meetingInfo.title;
        meetingDateTimeEl.textContent = meetingInfo.dateTime || '';
        meetingInfoEl.classList.remove('hidden');
      }
    }
    
    const partResponse = await sendMessage(tab.id, { action: 'getParticipants' });
    if (partResponse?.data && partResponse.data.length > 0) {
      participants = partResponse.data;
      participantCountEl.textContent = participants.length;
      participantsListEl.innerHTML = participants.map(p => {
        const classes = ['participant'];
        if (p.role === 'Organizer') classes.push('organizer');
        let label = escapeHtml(p.name);
        if (p.isCurrentUser) label += ' (You)';
        if (p.role) label += ' - ' + p.role;
        return '<span class="' + classes.join(' ') + '">' + label + '</span>';
      }).join('');
      participantsSectionEl.classList.remove('hidden');
    }
    
    setStatus('Ready to extract transcript from this meeting.', 'info');
  } catch (error) {
    console.error('Init error:', error);
    setStatus('Ready to extract transcript.', 'info');
  }

  extractBtn.addEventListener('click', async () => {
    setStatus('Extracting transcript...', 'info');
    extractBtn.disabled = true;
    extractBtn.innerHTML = '<span class="spinner"></span> Extracting...';

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0].id;
      
      await injectContentScript(tabId);
      
      const action = scrollToLoadCheckbox.checked ? 'scrollAndExtract' : 'extractTranscript';
      const response = await sendMessage(tabId, { action });
      
      let transcriptEntries = response?.data || [];
      
      if (transcriptEntries.length === 0) {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: directExtract
        });
        
        for (const r of results) {
          if (r.result && Array.isArray(r.result)) {
            transcriptEntries.push(...r.result);
          }
        }
        transcriptEntries = deduplicateEntries(transcriptEntries);
      }
      
      if (transcriptEntries.length > 0) {
        extractedData = formatOutput(transcriptEntries, includeTimestampsCheckbox.checked);
        displayPreview(transcriptEntries);
        setStatus('Successfully extracted ' + transcriptEntries.length + ' entries.', 'success');
        downloadBtn.disabled = false;
      } else {
        setStatus('No transcript found. Make sure the Transcript tab is open in the meeting Recap.', 'error');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      setStatus('Error: ' + error.message, 'error');
    } finally {
      extractBtn.disabled = false;
      extractBtn.innerHTML = '<span>📥</span> Extract Transcript';
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!extractedData) return;
    
    const blob = new Blob([JSON.stringify(extractedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = (meetingInfo?.title || 'transcript').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const filename = safeName + '_' + new Date().toISOString().split('T')[0] + '.json';
    
    chrome.downloads.download({ url, filename, saveAs: true });
  });

  async function sendMessage(tabId, message) {
    return new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  async function injectContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js']
      });
    } catch (e) {}
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
  }

  function displayPreview(entries) {
    previewEl.classList.remove('hidden');
    entriesEl.innerHTML = '';
    
    entries.slice(0, 5).forEach(entry => {
      const div = document.createElement('div');
      div.className = 'entry';
      div.innerHTML = '<span class="speaker">' + escapeHtml(entry.speaker) + '</span>' +
        '<span class="timestamp">' + escapeHtml(entry.timestamp) + '</span>' +
        '<div class="text">' + escapeHtml(entry.text) + '</div>';
      entriesEl.appendChild(div);
    });
    
    countEl.textContent = entries.length > 5 
      ? 'Showing 5 of ' + entries.length + ' entries'
      : entries.length + ' entries total';
  }

  function formatOutput(entries, includeTimestamps) {
    return {
      meeting: {
        title: meetingInfo?.title || '',
        dateTime: meetingInfo?.dateTime || '',
        url: meetingInfo?.url || ''
      },
      participants: participants.map(p => ({
        name: p.name,
        role: p.role || null,
        isCurrentUser: p.isCurrentUser || false
      })),
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      transcript: entries.map(entry => {
        const item = { speaker: entry.speaker, text: entry.text };
        if (includeTimestamps) item.timestamp = entry.timestamp;
        return item;
      })
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function deduplicateEntries(entries) {
    const seen = new Set();
    return entries.filter(e => {
      if (!e || !e.text) return false;
      const key = e.speaker + '|' + e.timestamp + '|' + e.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
});

function directExtract() {
  const entries = [];
  document.querySelectorAll('div, p, span').forEach(el => {
    if (el.children.length > 5) return;
    const text = el.innerText?.trim();
    if (!text || text.length > 2000 || text.length < 10) return;
    
    const lines = text.split('
').filter(l => l.trim());
    let speaker = '', timestamp = '', msgLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(/^([A-Z][a-z]+(?:s+[A-Z][a-z'-]+)*)s+(d{1,2}:d{2}(?::d{2})?)$/);
      if (match) {
        if (speaker && msgLines.length > 0) {
          entries.push({ speaker, timestamp, text: msgLines.join(' ').trim() });
        }
        speaker = match[1];
        timestamp = match[2];
        msgLines = [];
      } else if (speaker) {
        const line = lines[i].trim();
        if (!line.includes('started transcription') && !line.includes('AI-generated')) {
          msgLines.push(line);
        }
      }
    }
    if (speaker && msgLines.length > 0) {
      entries.push({ speaker, timestamp, text: msgLines.join(' ').trim() });
    }
  });
  return entries;
}