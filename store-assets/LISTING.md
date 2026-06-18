# Chrome Web Store listing — draft copy

Paste-ready text for the developer dashboard, plus the image shot-list.

## Name

Blip

## Summary (≤132 chars)

> See which claude.ai chats are waiting on you. Adds 🔴/✅ status labels to your
> chat titles, synced to mobile.

(123 chars — within limit.)

## Category

Productivity

## Detailed description

> **Know which Claude conversations need you.**
>
> claude.ai gives you one long, flat list of chats with no sense of which ones
> are finished and which are still waiting on your reply. Blip
> fixes that.
>
> It adds a 🔴 prefix to chats where the ball is in your court, and a ✅ prefix
> to ones that are done — right in the chat title, so the labels show up on the
> mobile app too. Click the toolbar icon for a tidy "waiting on you" list you
> can jump straight into.
>
> **How it works**
> 1. A one-time setup adds a short instruction to your Claude profile so Claude
>    ends replies with a small 🔴 / ✅ status marker. (The extension walks you
>    through it on install — it appends to your existing preferences, nothing is
>    overwritten.)
> 2. The extension reads that marker and labels the chat title accordingly.
>
> That's it. Labelling is exact — it reads the marker Claude wrote, it does not
> guess.
>
> **Private by design**
> There's no server and no analytics. The extension talks only to claude.ai,
> using your existing login, exactly like the website does. Nothing is sent
> anywhere else. Your settings and a small change-tracking cache stay on your
> device.
>
> **Optional extras**
> • Mirror status to stars, so your Starred section becomes your mobile queue.
> • Adjustable background re-check interval.
>
> Unofficial community tool. Not affiliated with or endorsed by Anthropic. It
> relies on undocumented claude.ai endpoints and may break if those change.

## Permission justifications (dashboard requires one per permission)

- **host permission `https://claude.ai/*`** — The extension reads your
  conversation list and recent messages to detect the status marker, and
  renames chat titles. These are calls to claude.ai using your own session.
- **storage** — Stores your settings and a local cache of conversation
  IDs → last-updated timestamps so unchanged chats are skipped. No chat content
  is stored.
- **alarms** — Schedules the periodic background re-check that catches chats you
  finished on another device.

## Single purpose statement

> The extension's single purpose is to label claude.ai conversation titles with
> a status indicator (waiting / resolved) derived from the conversation content.

## Data privacy form (Web Store)

- Does it collect user data? **No data leaves the browser.** Declare: reads chat
  content for the labelling function only; processed locally; not sold; not
  transferred to third parties; not used for unrelated purposes.
- Privacy policy URL: link to PRIVACY.md (host on GitHub Pages or the repo).

## Image assets needed (capture from a real browser)

| Asset | Size | Shot |
| --- | --- | --- |
| Screenshot 1 | 1280×800 | claude.ai sidebar showing 🔴 / ✅ prefixed chat titles |
| Screenshot 2 | 1280×800 | The extension popup — "Waiting on you" list with a few chats |
| Screenshot 3 | 1280×800 | The onboarding/setup page (copy-prompt step) |
| Screenshot 4 | 1280×800 | The options page |
| Small promo tile | 440×280 | Icon + tagline "Know which chats are waiting on you" |
| Store icon | 128×128 | `extension/icons/icon128.png` (already have it) |

Tips: use a clean Claude account/theme for screenshots; blur any private chat
titles; 1280×800 is preferred over 640×400.

## Pre-submit checklist

- [ ] Privacy policy reachable at a public URL
- [ ] All 4 permission justifications entered
- [ ] Single-purpose statement entered
- [ ] At least one 1280×800 screenshot
- [ ] $5 developer account registered
- [ ] `extension/` zipped (exclude repo files — zip the folder contents only)
