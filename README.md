# Teams Transcript Exporter

A Chrome extension that exports Microsoft Teams meeting transcripts to Markdown with a single click.

## What it does

Opens the Intelligent Recap page for a Teams meeting, click the extension icon, and the transcript downloads automatically as a `.md` file. No popup, no extra steps.

The extension scrolls through the full transcript list, collects every utterance, and writes a structured Markdown document with the meeting title, date, and each speaker's lines formatted as headings.

## Output format

```markdown
# Weekly Sync

Date: Friday, February 6, 2026 11:30 AM - 12:00 PM

---

## Transcript

### Alice — 0:01

Good morning everyone.

### Bob — 0:03

Let's go through the agenda.
```

The filename is `transcript_YYYYMMDD.md`.

## Installation

Chrome does not install unsigned extensions from the filesystem by default. To sideload:

1. Go to `chrome://extensions`
2. Enable "Developer mode" (toggle in the top-right corner)
3. Click "Load unpacked"
4. Select the `teams-transcript-exporter` directory

The extension icon appears in the toolbar.

## Usage

1. In Teams, open a meeting's Intelligent Recap page and navigate to the Transcript tab
2. Click the extension icon
3. The badge shows `...` while extracting
4. The file downloads automatically when complete
5. If something goes wrong the badge shows `!` briefly — check the browser console for details

The extension only activates on `teams.microsoft.com` and `teams.cloud.microsoft` pages.

## Tech stack

- Chrome Extension Manifest V3
- Service worker (`background.js`) — orchestration, downloads
- Content script (`content.js`) — DOM extraction, iframe relay
- No build step, no dependencies
