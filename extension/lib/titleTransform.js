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
 *    (Concretely: always STRIP any existing 🔴/✅ prefix before adding one.)
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
 */

const PREFIXES = ['🔴', '✅'];

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
 * @returns {string} the title the conversation should have
 */
export function titleTransform(currentTitle, status) {
  if (!status) return currentTitle;
  const base = stripPrefix(currentTitle);
  return (status === 'waiting' ? '🔴 ' : '✅ ') + base;
}
