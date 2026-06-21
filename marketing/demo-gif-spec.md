# Demo GIF — recording spec

The walkthrough clip is the highest-converting asset for launch. This documents
exactly what to capture so it can be recorded later in one sitting.

## Where it gets used
- **README** — replace the placeholder in the Demo section with `![bliptracker demo](marketing/demo.gif)`.
- **Reddit / X / Product Hunt** — drop into the `[demo GIF here]` slots in `launch-posts.md`.
- **Chrome Web Store** — note: the store does **not** accept GIFs. It takes static
  screenshots (done) plus an optional **YouTube video**. So export an MP4 too and,
  if you want video on the listing, upload it to YouTube and link it there.

## The story (≈8–12 seconds, looping)
Keep it tight — show the loop, not a tutorial.

1. **Setup state (0–2s):** a claude.ai chat open, mid-conversation. Claude's last
   reply visibly ends with `🔴 Waiting on you: …`.
2. **The label appears (2–5s):** pan/cut to the sidebar — the chat's title gains
   the `🔴` prefix (the instant content-script update). This is the "aha".
3. **The queue (5–9s):** click the bliptracker toolbar icon → the **"Waiting on
   you"** popup opens with the count badge and 2–3 `🔴` chats.
4. **(Optional, 9–12s):** click a row → it jumps straight into that chat; or show
   a chat resolving to `✅` and dropping off the list.

## Before you record
- **Use throwaway/demo chats** with non-sensitive titles (e.g. "Boiler quote",
  "Tax return") — or blur anything real. The labels are the star, not the content.
- **Pre-populate:** have ~3 chats already marked `🔴` and 1 `✅` so the popup looks
  alive when opened.
- Make sure the **preference prompt is active** in your Claude profile, so markers
  actually appear.
- Clean browser: hide bookmarks bar, use a tidy window, default zoom.

## Capture settings
- **Crop tight** to the area of interest (sidebar + the popup), not the whole screen.
- **Resolution:** record at 2× / retina, target ~1000–1280px wide output for crispness.
- **Frame rate:** ~15 fps is plenty for a GIF and keeps the file small.
- **Length:** 8–12s, and make it **loop** cleanly (end roughly where it began).

## Tools (macOS)
- **Kap** (free) or **CleanShot X** — record a region, export GIF directly.
- Or **QuickTime** screen-record → convert with **Gifski** (great palette/size).
- Aim for a **GIF under ~5–8 MB** so it loads fast on GitHub and Reddit; if it's
  bigger, drop fps or trim length.

## Output & wiring
- Save the GIF as **`marketing/demo.gif`** (and optionally keep a high-res
  `marketing/demo.mp4`).
- In `README.md`, swap the Demo placeholder for: `![bliptracker demo](marketing/demo.gif)`.
- Paste it into the `[demo GIF here]` slots in `marketing/launch-posts.md`.
