# bliptracker

**bliptracker is the scope for your AI chats** — a Chrome extension that labels your
[claude.ai](https://claude.ai) conversations with a 🔴 / ✅ prefix so you can see
at a glance which ones are **waiting on you** versus done — on desktop and on
mobile. `bliptracker.xyz`

> Unofficial community tool. Not affiliated with or endorsed by Anthropic. It
> uses undocumented claude.ai endpoints and may break without notice.

![bliptracker icon](extension/icons/icon128.png)

## How it works

1. A one-time **preference prompt** in your Claude profile makes Claude end
   substantive replies with a machine-readable marker:
   `🔴 Waiting on you: <reason>` or `✅ Resolved — safe to archive`. This runs
   everywhere you use Claude, including mobile.
2. The extension reads that marker and renames the chat title with a `🔴` / `✅`
   prefix. Because titles are stored server-side, the labels **sync to the
   claude.ai mobile app** automatically — you only run the extension on desktop.
3. Click the toolbar icon for a **“waiting on you” queue** of your 🔴 chats; the
   badge shows the count.

Classification is deterministic — a string match on the marker Claude wrote,
never an after-the-fact guess.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the `extension/` folder.
2. A setup tab opens automatically. Copy the preference prompt into your Claude
   profile settings (it links you straight there).
3. Done. New markers get picked up instantly in the chat you're viewing, and a
   background sweep (default every 10 min) catches chats finished on mobile.

## Settings

Right-click the toolbar icon → **Options** (or the **Settings** link in the
popup):

- **Enabled** — master switch.
- **Mirror status to stars** — also star 🔴 chats / unstar ✅ ones, so the
  Starred section is your mobile queue. _Off by default_ so it doesn't collide
  with stars you set manually.
- **Sweep interval** — how often to re-check all chats. The chat you're actively
  viewing updates instantly regardless.

## Architecture

- **Two triggers, one brain.** `content.js` (instant, the chat you're viewing)
  and the alarm sweep (periodic, all chats incl. mobile-finished) both funnel
  through `checkConversation`/`applyStatus` in `background.js`. No classify or
  rename logic is duplicated in the content script.
- **Idempotent renames.** Renaming bumps a chat's `updated_at`, so the next
  sweep re-checks it — `titleTransform()` is idempotent, so the re-check is a
  no-op. Convergence by design, no bookkeeping.
- **Best-effort DOM paint.** The instant sidebar update writes to claude.ai's
  DOM; if React reverts it, the resulting mutation re-triggers our observer and
  we re-apply. The server-side rename is the source of truth regardless.
- **No backend.** All requests go directly to claude.ai with your own session;
  nothing is sent anywhere else. See [PRIVACY.md](PRIVACY.md).

## Confirmed endpoints (recon 2026-06-12)

All under `/api/organizations/{orgId}`:

| Method | Path | Use |
| --- | --- | --- |
| GET | `/chat_conversations?limit=N` | list (incl. `updated_at`, `is_starred`) |
| GET | `/chat_conversations/{uuid}` | full chat incl. `chat_messages[]` |
| PUT | `/chat_conversations/{uuid}` `{"name":…}` | rename |
| PUT | `/chat_conversations/{uuid}` `{"is_starred":bool}` | star |
| DELETE | `/chat_conversations/{uuid}` | delete (unused) |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for shipped features, what's next, and planned
future work (e.g. a popup "Resolve" button, one-click preference injection,
bulk-archive, and multi-AI adapters).

## Development

Pure JS, no build step. Logic in `extension/lib/` (`classify.js`,
`titleTransform.js`) is unit-testable with plain Node:

```sh
node --input-type=module -e "import {classify} from './extension/lib/classify.js'; console.log(classify('x\n✅ Resolved — safe to archive this chat.'))"
```

## License

[MIT](LICENSE) © 2026 Andrew Miller
