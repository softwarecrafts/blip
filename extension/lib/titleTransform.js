/**
 * Title policy: given a conversation's current title and its classified
 * status, return the title it SHOULD have.
 *
 * The sweep calls this for every conversation it re-checks and only issues
 * a rename when the returned title differs from the current one.
 *
 * HARD REQUIREMENTS (the poller depends on these):
 *
 * 1. IDEMPOTENT: titleTransform(titleTransform(t, s), s) === titleTransform(t, s).
 *    Renaming bumps the conversation's updated_at, so the next sweep will
 *    re-process the same chat. If the transform isn't idempotent the
 *    extension renames it again, which bumps updated_at again... forever.
 *    (Concretely: always STRIP any existing 💤🔴/🔴/✅ prefix before adding one.)
 *
 * 2. status === null  ->  return currentTitle UNCHANGED. No marker means we
 *    know nothing; never touch a chat without an explicit signal.
 *
 * DESIGN CHOICES THAT ARE YOURS (this is the policy you'll see in your
 * sidebar every day):
 *  - 'resolved': prefix with '✅ ' so done-chats are visibly archivable?
 *    Or strip the prefix entirely so resolved chats just look normal?
 *  - A chat that was 🔴 and is now resolved: does ✅ replace 🔴? (It should,
 *    if you strip-then-add.)
 *  - Anything else you want — e.g. cap title length after prefixing.
 *
 * IGNORE: a chat can also be taken off the radar entirely. That state lives in
 * the title too, as a '🔕' prefix, so it syncs to mobile and the extension
 * picks it up automatically — even if you type '🔕' into a title by hand.
 * Ignore WINS over every status: an ignored chat is never given 🔴/✅, and the
 * sweep skips classifying it (see orchestrator). No local storage or alarm is
 * needed, unlike snooze, because ignore has no time component.
 */

// Longest first so stripPrefix removes '💤🔴' whole instead of leaving '🔴'.
const PREFIXES = ['💤🔴', '🔕', '💤', '🔴', '✅'];

/** The ignore marker, prepended to a title taken off the radar. */
export const IGNORE_PREFIX = '🔕';

/** True if this title is marked "ignored" (off the radar). */
export function isIgnored(title) {
  return title.trimStart().startsWith(IGNORE_PREFIX);
}

/** Remove all leading status prefixes (with or without spaces) from a title. */
export function stripPrefix(title) {
  let t = title.trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const p of PREFIXES) {
      if (t.startsWith(p)) {
        t = t.slice(p.length).trim();
        stripped = true;
      }
    }
  }
  return t;
}

/**
 * @param {string} currentTitle - the conversation's title right now
 * @param {'waiting' | 'resolved' | null} status - from classify()
 * @param {boolean} [snoozed] - chat has an unexpired snooze (isSnoozed)
 * @param {boolean} [ignored] - chat is off the radar (isIgnored)
 * @returns {string} the title the conversation should have
 *
 * Ignore wins over everything: an ignored chat is normalised to '🔕 <base>'
 * regardless of status or snooze, so it never carries a 🔴/✅ and reading its
 * title back still reports it as ignored (idempotent). This is what lets the
 * sweep skip classifying it while keeping the title tidy.
 *
 * Otherwise snooze only decorates 'waiting': a snoozed 🔴 chat shows 💤🔴 (still
 * red — it does need you, just not yet). 'resolved' wins over snooze, and a
 * chat with no marker stays untouched even if a stale snooze entry exists.
 */
export function titleTransform(currentTitle, status, snoozed = false, ignored = false) {
  if (ignored) return '🔕 ' + stripPrefix(currentTitle);
  if (!status) return currentTitle;
  const base = stripPrefix(currentTitle);
  if (status === 'resolved') return '✅ ' + base;
  return (snoozed ? '💤🔴 ' : '🔴 ') + base;
}
