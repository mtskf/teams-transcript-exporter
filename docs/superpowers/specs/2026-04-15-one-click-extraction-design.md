# One-Click Transcript Extraction

## Problem

The current flow requires two user actions (open popup, click button) and has a bug where closing the popup before extraction completes can interrupt the process, because popup.js acts as the message broker between the content script and the service worker.

## Solution

Remove the popup entirely. Use `chrome.action.onClicked` to trigger extraction directly from the extension icon click, with the service worker orchestrating the entire flow.

## Architecture

```
Icon click
  -> background.js receives chrome.action.onClicked
  -> Sets badge to "..." (extracting)
  -> Sends START_SCRAPING to content script via chrome.tabs.sendMessage
  -> content.js extracts transcript (existing logic, unchanged)
  -> content.js sends TRANSCRIPT_READY back via chrome.runtime.sendMessage
  -> background.js triggers download
  -> Clears badge
```

On error: badge shows "!" for 3 seconds, then clears.

## Changes

### manifest.json
- Remove `default_popup` from `action` (keep icons only)

### background.js
- Add `chrome.action.onClicked` listener
  - Validate tab URL is teams.microsoft.com or teams.cloud.microsoft
  - Set badge text to "..." with blue background
  - Send `START_SCRAPING` message to active tab's content script
- Add error handling: on failure, set badge to "!" for 3 seconds
- On successful download: clear badge
- Existing `TRANSCRIPT_READY` handler remains unchanged

### popup.html / popup.js
- Delete both files

### content.js
- No changes. The existing message listener for `START_SCRAPING` and the `chrome.runtime.sendMessage` for `TRANSCRIPT_READY` work identically whether the sender is popup.js or background.js.

## Edge Cases

- User clicks icon while not on Teams recap page: badge shows "!" briefly, no action taken
- User clicks icon while extraction is already in progress: ignore (check running state)
- Extraction fails (iframe not found, no transcript cells): content.js sends SCRAPING_ERROR, background.js shows "!" badge
- Service worker idle timeout: not a concern since the content script does the heavy lifting and sends back results via chrome.runtime.sendMessage which wakes the service worker

## Badge States

| State | Badge Text | Background Color |
|-------|-----------|-----------------|
| Idle | (none) | - |
| Extracting | "..." | #0078d4 (Teams blue) |
| Error | "!" | #d42020 (red) |
