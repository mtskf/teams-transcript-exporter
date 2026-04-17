# Architecture

## Overview

Teams Transcript Exporter is a Manifest V3 Chrome extension that extracts transcripts from the Microsoft Teams Intelligent Recap page and saves them as Markdown files. It has no popup UI — clicking the extension icon triggers the entire flow.

The extension has two runtime contexts that must communicate across the Chrome extension boundary and a cross-origin iframe boundary:

- `background.js` — MV3 service worker, orchestrates the flow and handles downloads
- `content.js` — injected into both the Teams top-level page and its `xplatIframe`, handles DOM extraction

## File Responsibilities

### manifest.json

Declares MV3, grants `activeTab`, `scripting`, and `downloads` permissions. Content scripts are registered to run at `document_start` with `all_frames: true` so the same `content.js` file is injected into both the parent page and any child iframes matching the host patterns.

Host permissions cover:
- `https://teams.microsoft.com/*`
- `https://teams.cloud.microsoft/*`
- `https://*.sharepoint.com/*`

### background.js

Sole entry point. Listens for `chrome.action.onClicked`, validates the active tab is a Teams URL, then:

1. Injects `content.js` programmatically into all frames via `chrome.scripting.executeScript`
2. Sends `START_SCRAPING` to the top-level content script via `chrome.tabs.sendMessage`
3. Listens for `TRANSCRIPT_READY` or `SCRAPING_ERROR` responses via `chrome.runtime.onMessage`
4. On success, triggers a `chrome.downloads.download` to save the Markdown file

Badge states reflect extraction progress:

| State      | Text  | Color              |
|------------|-------|--------------------|
| Idle       | (none) | —                 |
| Extracting | `...` | `#0078d4` (Teams blue) |
| Error      | `!`   | `#d42020` (red)    |

An `isExtracting` flag (in-memory) prevents concurrent extractions. A 180-second timeout guard calls `failExtraction` if no response arrives.

### content.js

Runs in two modes, selected at runtime by checking `window.self === window.top`:

**Top-level mode** (parent page, `teams.microsoft.com`):
- Listens for `START_SCRAPING` from the service worker
- Reads meeting title and date from the DOM
- Locates the `#xplatIframe` element and sends `START_SCRAPING_IFRAME` via `postMessage`
- Listens for `TRANSCRIPT_COLLECTED` or `SCRAPING_ERROR` from the iframe
- Assembles the Markdown string and sends `TRANSCRIPT_READY` to the service worker

**Iframe mode** (`xplatIframe` cross-origin context):
- Listens for `START_SCRAPING_IFRAME` via `postMessage`
- Validates the sender origin against the known Teams domains before proceeding
- Scrolls the virtual list container (`[class*="focusZoneWithAutoScroll"]`) from top to bottom
- Collects `.ms-List-cell` nodes, deduplicates by full `innerText`, and parses each into `{ speaker, timestamp, text }`
- Sends `TRANSCRIPT_COLLECTED` (or `SCRAPING_ERROR`) back to `window.parent`

A module-guard flag (`window._teamsTranscriptLoaded`) prevents double-initialization when both the declarative content script and programmatic injection run in the same frame.

## Message Flow

```
User clicks icon
       |
       v
background.js: chrome.action.onClicked
       | validates Teams URL
       | sets badge "..."
       | chrome.scripting.executeScript (all frames)
       |
       v
background.js: chrome.tabs.sendMessage → START_SCRAPING
       |
       v
content.js (top-level): chrome.runtime.onMessage
       | reads meeting title + date from DOM
       | locates #xplatIframe
       |
       v  postMessage(START_SCRAPING_IFRAME, targetOrigin)
       |
content.js (iframe): window.addEventListener('message')
       | validates event.origin
       | scrolls virtual list, collects cells
       |
       v  window.parent.postMessage(TRANSCRIPT_COLLECTED, parentOrigin)
       |
content.js (top-level): window.addEventListener('message')
       | validates event.source === iframe.contentWindow
       | validates event.origin against iframe.src origin
       | builds Markdown string
       |
       v  chrome.runtime.sendMessage(TRANSCRIPT_READY)
       |
background.js: chrome.runtime.onMessage
       | clears badge
       | chrome.downloads.download → transcript_YYYYMMDD.md
```

Error path: any failure sends `SCRAPING_ERROR` up the same chain, ultimately showing the `!` badge for 3 seconds.

## Security Model

### Origin validation for postMessage

- Parent → iframe: `targetOrigin` is set to `new URL(iframe.src).origin` when available. If `iframe.src` is empty or unparseable at call time (Teams sets it dynamically), falls back to `'*'`. This is safe because the message is a non-sensitive trigger command and the receiving iframe validates `event.origin` against a Teams domain allowlist.
- Iframe → parent: `window.parent.postMessage` uses `parentOrigin` captured from `event.origin` at the time the iframe received the trigger message. The parent validates `event.source === iframe.contentWindow` for all messages. When `iframe.src` is present and parseable, it also checks `event.origin` against the derived origin; if `iframe.src` is absent or unparseable, the `event.source` check alone is the guard.

### Iframe message origin allowlist

The iframe handler validates `event.origin` against a strict allowlist before processing any message:
- `https://teams.microsoft.com`
- `https://*.teams.microsoft.com`
- `https://teams.cloud.microsoft`
- `https://*.teams.cloud.microsoft`

Messages from any other origin are silently dropped.

### Host permission scope

`activeTab` and `scripting` permissions limit injection to the currently active tab. Host permissions are restricted to the Teams and SharePoint domains; no broad `<all_urls>` access is requested.

### No persistent background state

The service worker has no access to transcript content — it only stores a short `isExtracting` boolean and a timer handle. All DOM access and data assembly happens inside `content.js`, which runs in the renderer process and never sends data to an external server.
