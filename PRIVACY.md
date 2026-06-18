# Privacy Policy — Blip

_Last updated: 2026-06-18_

Blip is a browser extension that labels your claude.ai chat
titles based on status markers in your conversations. This policy explains
exactly what it touches.

## What it accesses

- **Your claude.ai conversations.** The extension reads your conversation list
  and the text of recent messages in order to detect the 🔴 / ✅ status marker
  and to rename chat titles. It does this by calling claude.ai's own endpoints
  using your existing logged-in session, exactly as the website does.

## What it stores

All storage is **local to your browser** (`chrome.storage.local`). Specifically:

- your claude.ai organization ID (to address the API),
- a map of conversation IDs to their last-seen update timestamp (so the
  extension only re-checks chats that changed), and
- your settings (enabled, star mirroring, sweep interval).

No chat content is stored.

## What it sends, and to whom

- **Nothing is sent to the developer or any third party.** There is no backend
  server, no analytics, and no telemetry.
- The only network requests the extension makes are to **claude.ai**, the same
  service you are already using, authenticated by your own browser session.

## Permissions

- `host_permissions: https://claude.ai/*` — to read and rename your chats.
- `storage` — to keep the small local state described above.
- `alarms` — to schedule the periodic background re-check.

## Your control

Disable the extension at any time from its Settings page, or remove it from
`chrome://extensions`. Uninstalling clears all locally stored data. Renames the
extension has already made to your chat titles remain on your account; you can
edit those titles back manually in claude.ai.

## Not affiliated with Anthropic

This is an unofficial, community-built tool. It is not affiliated with,
endorsed by, or supported by Anthropic. It relies on undocumented claude.ai
endpoints that may change at any time.

## Contact

info@akmiller.co.uk
