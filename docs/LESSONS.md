# Development Lessons

Practical findings from building this extension. Recorded to avoid repeating the same mistakes.

---

## MV3 service worker: in-memory state can vanish

MV3 service workers are event-driven and can be terminated by Chrome at any time between events — typically after ~30 seconds of inactivity. Any in-memory variable (e.g. `isExtracting`, timer handles) is lost when the worker sleeps and reinstated from scratch on the next event.

For `isExtracting` this is currently acceptable because the extraction round-trip completes well within the worker's active window. But if the service worker is ever woken by an unrelated event mid-extraction, the guard will be gone and a second click could start a parallel run.

The correct fix is `chrome.storage.session` (requires the `storage` permission), which persists across sleep cycles but is cleared when the browser closes. See `TODO.md`.

---

## Cross-origin iframe communication: you cannot use chrome.tabs.sendMessage

`chrome.tabs.sendMessage` routes to the top-level frame. Frames injected from a different origin (Teams uses `xplatIframe` served from a subdomain) receive the injection but do not share the same `chrome.runtime` message channel in a way that is reliably addressable by frame ID from within `content.js`.

The working pattern: the top-level content script acts as a relay. It receives `START_SCRAPING` from the service worker, then forwards `START_SCRAPING_IFRAME` to the iframe via `postMessage`. Results travel back the same way.

---

## Teams DOM: compact format replaced the 5-line format

Early in development the transcript list rendered each cell as five lines:

```
Speaker Name
3 minutes 29 seconds    ← relative time
0:42                    ← absolute timestamp
Transcript              ← label
The actual spoken text.
```

A Teams update replaced this with a 2–4 line compact format:

```
Speaker Name 3 minutes 29 seconds
0:42
The actual spoken text.
```

The parser now checks `lines.length`:
- `>= 5`: legacy format — speaker at index 0, timestamp at index 2, content from index 4
- `2–4`: compact format — strip trailing relative-time suffix from line 0 to get speaker name, find absolute timestamp with `/\d{1,2}:\d{2}/`, filter out time-only lines for content

Both branches produce `{ speaker, timestamp, text }`.

---

## postMessage targetOrigin: always specify the exact origin

Passing `'*'` as `targetOrigin` means any page that happens to be embedded in the same window can read the message. This matters here because `postMessage` carries transcript content.

The extension now resolves the iframe's origin at call time:

```js
let targetOrigin;
try { targetOrigin = new URL(iframe.src).origin; } catch { targetOrigin = '*'; }
iframe.contentWindow.postMessage({ type: 'START_SCRAPING_IFRAME' }, targetOrigin);
```

The fallback to `'*'` is deliberate — a missing or unparseable `src` should not silently break the flow — but it is worth eliminating. Track `TODO.md` item about tightening this.

On the receive side, the iframe's listener validates `event.origin` against a hardcoded allowlist of Teams domains and drops anything else.

---

## Content script double-injection guard

`manifest.json` declares `content_scripts` with `all_frames: true` and `run_at: document_start`. `background.js` also calls `chrome.scripting.executeScript` with `allFrames: true` on every icon click. This means `content.js` can be evaluated twice in the same frame.

The guard at the top of `content.js` prevents double-initialization:

```js
if (window._teamsTranscriptLoaded) { /* already initialized */ }
else {
  window._teamsTranscriptLoaded = true;
  // ... all initialization code
}
```

The underlying duplication (declarative + programmatic injection) is a known issue logged in `TODO.md`. The intent was to ensure the script is present before any click, but having both paths adds complexity. The cleaner resolution is to pick one strategy and remove the other.

---

## Virtual list scrolling: stop condition needs tolerance

The Teams transcript list uses a virtualized renderer (`focusZoneWithAutoScroll`). Cells outside the viewport are unmounted, so a single `querySelectorAll('.ms-List-cell')` only returns visible nodes. The extraction loop scrolls by 300 px increments and stops after 5 consecutive iterations with no change in `scrollTop`.

Two edge cases:

1. Rounding: fractional pixel positions can cause `scrollTop` to oscillate by ±1 even at the true bottom. The current equality check (`scrollTop === lastScrollTop`) misses this. A tolerance check (e.g. `Math.abs(current - last) <= 1`) would be more robust.
2. Deduplication key: cells are deduplicated by their full `innerText`. This works but is sensitive to minor rendering differences (e.g. trailing whitespace). A composite key of `speaker + timestamp + firstNCharsOfText` would be more precise.
