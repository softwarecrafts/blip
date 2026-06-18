/**
 * Deterministic status classification.
 *
 * The claude.ai preference prompt makes Claude end substantive replies with
 * exactly one status line:
 *   🔴 Waiting on you: <reason>
 *   ✅ Resolved — safe to archive this chat.
 * and reserves those emoji at line-start for this purpose only.
 *
 * This is a string match, never an inference. No marker -> null -> the
 * sweep leaves the conversation title completely untouched.
 */
export function classify(messageText) {
  if (!messageText) return null;
  const lines = messageText
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // The marker is the final line of the reply, but allow a little slack in
  // case the renderer appends trailing artifacts/footnotes after it.
  for (const line of lines.slice(-5).reverse()) {
    if (line.startsWith('🔴')) return 'waiting';
    if (line.startsWith('✅')) return 'resolved';
  }
  return null;
}
