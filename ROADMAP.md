# bliptracker — roadmap

Status of the project and what's planned. `bliptracker.xyz` · unofficial,
provider-neutral (Claude today, more later).

## ✅ Shipped

- **Core extension** (MV3): background sweep + instant content-script updates,
  deterministic 🔴/✅ classification from the marker Claude leaves in replies,
  idempotent title rename.
- **Star mirroring** (optional, off by default) — 🔴 ⇒ starred, ✅ ⇒ unstarred.
- **Popup queue** — toolbar icon shows the "waiting on you" list as deep links;
  badge shows the count.
- **Settings page** — enabled / star mirroring / sweep interval.
- **Onboarding page** — opens on install: copy the preference prompt + deep link
  to Claude settings.
- **Brand** — name *bliptracker*, "Instrument / Scope" identity (radar icon,
  phosphor green + reserved contact-red), Chakra Petch uppercase display.
- **Landing page** (`landing/`) — static, GitHub-Pages-ready, radar hero.
- **Docs** — README, PRIVACY, MIT LICENSE, store-listing draft.

## ▶️ Next (build-side, mine)

- **Adapter refactor** — pull the Claude-specific endpoints + DOM selectors
  behind an adapter interface so ChatGPT / Gemini become drop-in adapters.
  (Ship Claude-only first; this is the "neutral brand, adapter-ready" plan.)
- **Web Store screenshots** — capture popup / onboarding / options / a labelled
  sidebar at 1280×800 for the listing.
- **Listing polish** — rewrite `store-assets/LISTING.md` copy in the radar voice.
- **Fill landing placeholders** — GitHub URL, Web Store URL, Privacy link
  (blocked on the GitHub push + listing existing).

## 🔭 Future features

- **"Resolve" button in the popup** — per-blip button that closes a chat off
  with a resolution and flips it to ✅.
  - _Why it's not trivial:_ the title is *derived* from the chat's last marker
    every sweep, so a UI-only relabel would be reverted. The correct version
    **sends a wrap-up message** so Claude itself writes the resolution ending
    in `✅ Resolved`, which then propagates and syncs to mobile.
  - _Needs:_ recon of the claude.ai **completion endpoint** (streaming +
    message-tree params — more involved than the rename API we use today).
  - _Caveats:_ uses the user's usage quota; the chat's enabled MCP tools could
    fire on that turn, so the canned prompt must say "summarize only, no tools."
- **Bulk-archive ✅ chats** — sweep up resolved conversations in one action.
- **History pagination** — currently only the most recent ~50 chats are swept;
  paginate for full-history coverage if needed.
- **Extension-page brand fonts** — adopt Chakra Petch in onboarding/options
  (needs the font bundled locally for the extension, not a CDN link).
- **Multi-AI** — ChatGPT, Gemini adapters (depends on the adapter refactor).

## 🚚 Distribution

- [ ] Push to GitHub (repo currently local-only)
- [ ] Register / point `bliptracker.xyz`
- [ ] Host PRIVACY.md at a public URL (GitHub Pages)
- [ ] Chrome Web Store: $5 dev registration + submit
- [ ] Open-source the repo

## Notes / constraints

- Unofficial; relies on undocumented claude.ai endpoints that can change.
- No server, no analytics — all processing is local / direct to claude.ai.
- Confirmed endpoints (recon 2026-06-12) are documented in `README.md`.
