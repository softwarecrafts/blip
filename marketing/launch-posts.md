# bliptracker — launch posts (drafts)

Links to drop in:
- **Store:** https://chromewebstore.google.com/detail/bliptracker/dhbhcgiohdpemjhlcmldipoioafeeemj
- **Site:** https://bliptracker.xyz
- **GitHub:** https://github.com/softwarecrafts/blip

Before posting anywhere: have the **demo GIF** ready (it does most of the convincing),
post from an account with real history, lead with the problem (not the link), and
actually stick around to answer comments. Check each community's self-promo rules.

---

## Hacker News — Show HN

**Title:**
Show HN: bliptracker – see which of your Claude chats are waiting on you

**Body:**
claude.ai gives you one long, flat list of conversations with no sense of which
are finished and which are still waiting on *your* reply. I kept leaving browser
tabs open as a memory system. bliptracker fixes that.

How it works, and the part I think is interesting: instead of an extension trying
to *guess* a chat's state, I added one line to my Claude profile preferences so
Claude ends substantive replies with a tiny marker — `🔴 Waiting on you: …` or
`✅ Resolved`. The extension just reads that marker and prefixes the chat title
with 🔴 / ✅. So classification is deterministic — it's reading a signal the model
wrote, not inferring one. Because titles are stored server-side, the labels show
up in the mobile app too.

The title is *derived* from the last marker every sweep (idempotent), which makes
it self-healing but also means "mark resolved" has to actually change the
conversation, not just relabel — a fun little constraint.

Honest caveats: it's unofficial and rides claude.ai's undocumented endpoints, so
it can break when they change things. No server, no analytics — it talks only to
claude.ai with your own session. Open source (MIT).

Site: https://bliptracker.xyz · Code: https://github.com/softwarecrafts/blip

Would love feedback — especially on the onboarding (the one-line preference paste
is the part I'm least sure about).

---

## r/ClaudeAI

**Title:**
I made a free extension that shows which Claude chats are still waiting on your reply

**Body:**
You know the feeling — you've got 15 Claude chats on the go, Claude asked you
something in half of them, and the one you need to get back to has scrolled
somewhere into the list. I was keeping tabs open just so I wouldn't forget.

So I built **bliptracker**. It puts a 🔴 in front of chats that are waiting on you
and a ✅ on ones that are done — right in the chat title, so it shows up on mobile
too. Click the toolbar icon for a tidy "waiting on you" list.

Setup is one paste: you add a short line to your Claude *personal preferences* so
Claude ends replies with a small 🔴/✅ marker, and the extension reads it. It
never guesses — it only labels what Claude actually wrote.

Free, open source, no server, no analytics (it only talks to claude.ai with your
own login). It's an unofficial side project, not affiliated with Anthropic, and
it uses undocumented endpoints so it *could* break — but it's open source so it
can be fixed.

[demo GIF here]

Store: <link> · Code: <link>

Happy to answer anything — and genuinely keen for feedback on whether the setup
step feels worth it.

---

## Product Hunt

**Name:** bliptracker
**Tagline (≤60):** See which AI chats are waiting on your reply
**Topics:** Productivity, Chrome Extensions, Artificial Intelligence

**Description:**
bliptracker labels your claude.ai chats 🔴 (waiting on you) or ✅ (done) right in
the title — on desktop and mobile — so your conversations finally get an inbox.
One-time setup, deterministic (it reads a marker Claude writes, never guesses),
no server, no analytics, open source.

**Maker's first comment:**
Hey PH 👋 I built this to scratch my own itch: I had too many Claude chats going
and kept losing track of which ones were waiting on me. Rather than have the
extension guess, I let Claude tag its own replies with a 🔴/✅ marker (via a
one-line preference) and bliptracker just reads it. It's free, open source, and
private — talks only to claude.ai with your own session. It's unofficial and uses
undocumented endpoints, so fair warning it can break. Would love your feedback,
especially on the onboarding.

---

## X / Twitter (thread)

1/ I kept leaving Claude chats open in tabs so I wouldn't forget which ones were
waiting on me.

So I built bliptracker: it labels your claude.ai chats 🔴 waiting / ✅ done — right
in the title, synced to mobile. Free + open source. 🧵

2/ The trick: it doesn't *guess*. You add one line to your Claude preferences so
Claude ends replies with a 🔴/✅ marker. The extension just reads what the model
wrote. Deterministic, not heuristic.

3/ Click the toolbar icon → a tidy "waiting on you" queue, each a link straight
back into the chat.

No server, no analytics — it only talks to claude.ai with your own login.

4/ Unofficial side project, not affiliated with Anthropic, uses undocumented
endpoints (so it can break — but it's open source).

Add to Chrome → bliptracker.xyz

---

## r/SideProject (short)

**Title:** bliptracker — a 🔴/✅ "is this waiting on me?" label for your AI chats

Built a free Chrome extension that marks claude.ai chats waiting on your reply
(🔴) vs done (✅), in the title so it syncs to mobile. The neat bit: it reads a
marker Claude writes via a one-line preference, so labelling is exact, not
guessed. Open source, no server, no analytics. Feedback welcome 🙏
Site: <link> · Code: <link>

---

## r/chrome_extensions (short)

**Title:** [OSS] bliptracker — labels your claude.ai chats 🔴 waiting / ✅ done

MV3 extension. A background sweep + content script read a 🔴/✅ marker Claude
leaves in replies (enabled via a one-line preference) and prefix the chat title,
which syncs to mobile. Deterministic, idempotent rename; no server, no analytics;
MIT. Honest caveat: undocumented claude.ai endpoints, so it can break.
Code: <link>
