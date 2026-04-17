# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome Extension (Manifest V3) that exports Microsoft Teams Intelligent Recap transcripts to Markdown via one-click icon activation. No popup, no build step, no dependencies.

## Commands

No package.json. Validate with:

```bash
node --check background.js                    # syntax check
node --check content.js                       # syntax check
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"  # JSON check
```

No test framework, linter, or type checker is configured.

## Architecture

Three files, two runtime contexts, two communication boundaries:

```
background.js (service worker)
  ──chrome.tabs.sendMessage──▶  content.js (top-level, teams.microsoft.com)
                                  ──postMessage──▶  content.js (iframe, xplatIframe)
                                  ◀──postMessage──
  ◀──chrome.runtime.sendMessage──
  ──chrome.downloads.download──▶  transcript_YYYYMMDD.md
```

- `background.js` — MV3 service worker. Handles icon click (`chrome.action.onClicked`), injects content script, receives transcript, triggers download. Badge shows extraction state.
- `content.js` — Runs in both top-level page and iframe (branched on `window.self === window.top`). Top-level reads meeting metadata and relays messages. Iframe scrolls the virtual list, parses `.ms-List-cell` DOM nodes, and collects transcript data.
- `manifest.json` — MV3 config. `host_permissions` include `*.sharepoint.com` for iframe injection. `content_scripts` match only Teams domains.

Double-injection guard: `window._teamsTranscriptLoaded` prevents re-init when both declarative and programmatic injection fire.

## Key Patterns

- `sendWithRetry()` in content.js — retries `chrome.runtime.sendMessage` up to 2 times with 500ms delay (service worker may be waking up)
- `sendMessage` retry loop in background.js — retries `chrome.tabs.sendMessage` up to 5 times with 200ms delay (content script listener may not be registered yet)
- Cell parser supports two Teams DOM formats: legacy 5-line and compact 2-4 line. See inline comments in the iframe section of content.js.
- `postMessage` uses explicit `targetOrigin` (never `'*'`). Iframe-side validates `event.origin` against Teams domain allowlist. Parent-side validates `event.source === iframe.contentWindow`.

## Related Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — message flow diagram, security model, file responsibilities
- [docs/LESSONS.md](docs/LESSONS.md) — MV3 pitfalls, iframe cross-origin constraints, DOM format changes
- [docs/TODO.md](docs/TODO.md) — known issues and improvement backlog
