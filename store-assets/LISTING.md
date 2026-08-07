# Chrome Web Store listing — draft copy

Paste-ready text for the developer dashboard, plus the image shot-list.

## Name

bliptracker

## Summary (≤132 chars)

> See which claude.ai chats are waiting on you. Adds 🔴/✅ status labels to your
> chat titles, synced to mobile.

(123 chars — within limit.)

## Category

Productivity

## Detailed description

 **Know which Claude conversations need you.**

 claude.ai gives you one long, flat list of chats with no sense of which ones
 are finished and which are still waiting on your reply. bliptracker
 fixes that.

 It adds a 🔴 prefix to chats where the ball is in your court, and a ✅ prefix
 to ones that are done — right in the chat title, so the labels show up on the
 mobile app too. Click the toolbar icon for a tidy "waiting on you" list you
 can jump straight into.

 **How it works**
 1. A one-time setup adds a short instruction to your Claude profile so Claude
    ends replies with a small 🔴 / ✅ status marker. (The extension walks you
    through it on install — it appends to your existing preferences, nothing is
    overwritten.)
 2. The extension reads that marker and labels the chat title accordingly.

 That's it. Labelling is exact — it reads the marker Claude wrote, it does not
 guess.

 **A count you can trust**
 A list only helps if you believe it. Three flagged chats you can actually deal
 with is a to-do list. Three where one's waiting on a delivery and another is a
 weight log you'll never finish is just noise, and once it's noise you stop
 opening the popup at all. Two things keep it honest:
 • **Snooze** gets the ones you can't do yet out of the way until you can. Pick
   a time (in an hour, this evening, tomorrow 9am, next Monday, or a date of
   your own) and it leaves the list and the badge until then. The title reads
   💤🔴 meanwhile, so what's parked is still obvious from your phone. Nothing to
   remember: it comes back on its own.
 • **Ignore** stops the never-ending chats crying wolf. A weight log, a running
   journal: every entry draws a fresh 🔴, and after a week of false alarms
   you're skipping the whole list. Ignore it once and it's off for good, marked
   🔕 so it stays off on every device. Track again if you change your mind.

 **Private by design**
 There's no server and no analytics. The extension talks only to claude.ai,
 using your existing login, exactly like the website does. Nothing is sent
 anywhere else. Your settings and a small change-tracking cache stay on your
 device.

 **Optional extras**
 • Mirror status to stars, so your Starred section becomes your mobile queue.
 • Adjustable background re-check interval.

 **Permissions note**
 The `alarms` permission also drives snooze wake-ups, not just the periodic
 re-check — worth saying if a reviewer asks.

 Unofficial community tool. Not affiliated with or endorsed by Anthropic. It
 relies on undocumented claude.ai endpoints and may break if those change.

## Permission justifications (dashboard requires one per permission)

- **host permission `https://claude.ai/*`** — The extension reads your
  conversation list and recent messages to detect the status marker, and
  renames chat titles. These are calls to claude.ai using your own session.
- **storage** — Stores your settings and a local cache of conversation
  IDs → last-updated timestamps so unchanged chats are skipped. No chat content
  is stored.
- **alarms** — Schedules the periodic background re-check that catches chats you
  finished on another device, and the one-shot wake-up that un-snoozes a chat at
  the time you chose.

## Single purpose statement

> The extension's single purpose is to label claude.ai conversation titles with
> a status indicator (waiting / resolved) derived from the conversation content.

## Data privacy form (Web Store)

- Does it collect user data? **No data leaves the browser.** Declare: reads chat
  content for the labelling function only; processed locally; not sold; not
  transferred to third parties; not used for unrelated purposes.
- Privacy policy URL: link to PRIVACY.md (host on GitHub Pages or the repo).

## Image assets needed (capture from a real browser)

Built tiles live in `store-assets/screenshots/` (1280×800, rendered from
`store-assets/store-shots.html`):

| Asset | File | Shot |
| --- | --- | --- |
| Screenshot 1 | `shot-1-value.png` | Value + labelled chat list (🔴 / ✅) |
| Screenshot 2 | `shot-2-queue.png` | The "waiting on you" queue popup |
| Screenshot 3 | `shot-3-setup.png` | One-time setup (preference prompt) |
| Screenshot 4 | `shot-4-privacy.png` | Private by design |
| Store icon | 128×128 | `extension/icons/icon128.png` (have it) |

Still to make:
- **Small promo tile** 440×280 — icon + tagline (can add a 5th frame to
  `store-shots.html`).
- _(optional)_ a genuine in-product shot of your real claude.ai sidebar with
  🔴 / ✅ titles, captured from your own browser, to swap in as authenticity.

To regenerate: serve the repo root (`python3 -m http.server` from the project
folder) and screenshot each `#shot-N` in `/store-assets/store-shots.html`.

## Pre-submit checklist

- [x] Privacy policy reachable at a public URL
- [x] All 4 permission justifications entered
- [x] Single-purpose statement entered
- [x] 1280×800 screenshots (4, in `store-assets/screenshots/`)
- [x] 440×280 promo tile
- [x] $5 developer account registered
- [x] `extension/` zipped (exclude repo files — zip the folder contents only)
