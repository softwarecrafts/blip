/**
 * popup.js — the "waiting on you" queue.
 *
 * Asks the worker for the current 🔴 chats and renders them as deep links.
 * On open it shows the cached state instantly (one list call); Refresh runs a
 * full sweep first. The worker owns all logic — this is pure presentation.
 */
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');

function render(waiting) {
  countEl.textContent = waiting.length ? `${waiting.length}` : '';
  emptyEl.hidden = waiting.length > 0;
  listEl.replaceChildren(
    ...waiting.map(({ uuid, name }) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'chat';
      a.textContent = name;
      a.href = `https://claude.ai/chat/${uuid}`;
      a.title = name;
      // Open in a new tab via the extension so the popup can close cleanly.
      a.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: a.href });
        window.close();
      });
      li.appendChild(a);
      return li;
    })
  );
}

async function load(type) {
  const refresh = document.getElementById('refresh');
  refresh.disabled = true;
  refresh.textContent = type === 'run-sweep' ? '↻ Sweeping…' : '↻ Refresh';
  try {
    const res = await chrome.runtime.sendMessage({ type });
    if (res?.ok) render(res.waiting ?? []);
    else countEl.textContent = '!';
  } catch {
    countEl.textContent = '!';
  } finally {
    refresh.disabled = false;
    refresh.textContent = '↻ Refresh';
  }
}

document.getElementById('refresh').addEventListener('click', () => load('run-sweep'));
document.getElementById('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load('get-waiting'); // fast initial paint
