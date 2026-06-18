/** onboarding.js — copy-to-clipboard and settings link for the setup page. */
const copyBtn = document.getElementById('copy');
const promptEl = document.getElementById('prompt');

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(promptEl.value);
  } catch {
    // Clipboard API blocked: fall back to selecting the text manually.
    promptEl.select();
    document.execCommand('copy');
  }
  copyBtn.textContent = 'Copied ✓';
  setTimeout(() => (copyBtn.textContent = 'Copy prompt'), 1500);
});

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
