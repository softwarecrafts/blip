/* Progressive enhancement only — the page is fully readable without JS. */
document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

/* Reveal-on-scroll via IntersectionObserver (staggered within rows). */
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && reveals.length) {
  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.transitionDelay = `${Math.min(i * 70, 210)}ms`;
          entry.target.classList.add('in');
          obs.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }
  );
  reveals.forEach((el) => io.observe(el));
  // Safety net: never let content stay invisible if the observer misfires
  // (e.g. odd rendering, prerender, or a screenshot tool that doesn't scroll).
  setTimeout(() => reveals.forEach((el) => el.classList.add('in')), 2500);
} else {
  reveals.forEach((el) => el.classList.add('in'));
}

/* Copy-to-clipboard for the preference prompt (full text, not the truncated
   display version). Keep this string in sync with extension/onboarding.html. */
const FULL_PROMPT = `End every substantive reply with exactly one status line as the final line, choosing whichever is true:

🔴 Waiting on you: <one short clause saying what you need from me>
✅ Resolved — safe to archive this chat.

Rules:
- Use 🔴 whenever the next action is mine — you asked a question, offered options, or need a decision, information, or anything else from me.
- Use ✅ only when the conversation has reached a natural conclusion and nothing is pending from either of us.
- The status line must be the last line of the reply, starting with the emoji.
- Skip the status line entirely for trivial or quick factual exchanges.
- Never start a line with 🔴 or ✅ for any other purpose — automated tooling parses these markers from my chat history.`;

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(FULL_PROMPT);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = FULL_PROMPT;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1600);
  });
});

/* Placeholder links shouldn't jump the page; they're clearly marked TBD. */
document.querySelectorAll('a[data-placeholder]').forEach((a) => {
  if (a.getAttribute('href') === '#') {
    a.addEventListener('click', (e) => e.preventDefault());
  }
});
