/**
 * popup.js — the "waiting on you" queue.
 *
 * Asks the worker for the current 🔴 chats and renders them as deep links,
 * plus a collapsed "Snoozed" section for chats muted until a wake time.
 * On open it shows the cached state instantly (one list call); Refresh runs a
 * full sweep first. The worker owns all logic — this is pure presentation.
 *
 * If the popup stays open across a snooze expiry the lists go stale until
 * Refresh — accepted; no timers or storage listeners for a window this
 * short-lived.
 */
import { SNOOZE_PRESETS, presetWakeTime, formatWake } from './lib/snooze.js';

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const snoozedEl = document.getElementById('snoozed');
const snoozedListEl = document.getElementById('snoozed-list');
const snoozedCountEl = document.getElementById('snoozed-count');
const panelEl = document.getElementById('snooze-panel');
const customEl = document.getElementById('snooze-custom');

let panelTarget = null; // { platform, id } the open snooze panel targets

const sameChat = (a, b) => a && b && a.platform === b.platform && a.id === b.id;

// `url` comes from the adapter (conversationUrl) via the worker — the popup
// deliberately knows nothing about any platform's URL shape.
function chatLink(url, name) {
  const a = document.createElement('a');
  a.className = 'chat';
  a.textContent = name;
  a.href = url;
  a.title = name;
  // Open in a new tab via the extension so the popup can close cleanly.
  a.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: a.href });
    window.close();
  });
  return a;
}

function rowButton(text, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'row-btn';
  btn.textContent = text;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function render({ waiting = [], snoozed = [] }) {
  closePanel();
  countEl.textContent = waiting.length ? `${waiting.length}` : '';
  emptyEl.hidden = waiting.length > 0;

  listEl.replaceChildren(
    ...waiting.map(({ platform, id, url, name }) => {
      const li = document.createElement('li');
      li.appendChild(chatLink(url, name));
      li.appendChild(rowButton('💤', 'Snooze', () => togglePanel(li, { platform, id })));
      return li;
    })
  );

  snoozedEl.hidden = snoozed.length === 0;
  snoozedCountEl.textContent = snoozed.length ? `(${snoozed.length})` : '';
  snoozedListEl.replaceChildren(
    ...snoozed.map(({ platform, id, url, name, wakeAt }) => {
      const li = document.createElement('li');
      li.appendChild(chatLink(url, name));
      const wake = document.createElement('span');
      wake.className = 'wake';
      wake.textContent = formatWake(wakeAt);
      li.appendChild(wake);
      li.appendChild(rowButton('⏰', 'Wake now', () => send('unsnooze', { platform, id })));
      return li;
    })
  );
}

/* --- snooze panel (one shared instance, moved under the clicked row) --- */

// datetime-local wants local wall-clock "YYYY-MM-DDTHH:MM" — toISOString()
// is UTC and would shift the value by the timezone offset.
function toLocalDatetimeValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function togglePanel(li, target) {
  if (sameChat(panelTarget, target) && !panelEl.hidden) return closePanel();
  panelTarget = target;
  customEl.value = '';
  customEl.classList.remove('invalid');
  customEl.min = toLocalDatetimeValue(Date.now() + 60_000);
  li.after(panelEl);
  panelEl.hidden = false;
}

function closePanel() {
  panelEl.hidden = true;
  panelTarget = null;
  document.body.appendChild(panelEl); // park it outside the list
}

for (const { id, label } of SNOOZE_PRESETS) {
  const btn = document.createElement('button');
  btn.className = 'preset';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (panelTarget) send('snooze', { ...panelTarget, wakeAt: presetWakeTime(id) });
  });
  panelEl.insertBefore(btn, panelEl.querySelector('.custom-row'));
}

document.getElementById('snooze-set').addEventListener('click', () => {
  const wakeAt = new Date(customEl.value).getTime();
  if (!panelTarget || Number.isNaN(wakeAt) || wakeAt <= Date.now()) {
    customEl.classList.add('invalid');
    return;
  }
  send('snooze', { ...panelTarget, wakeAt });
});

/* --- worker round trips (all return the fresh {waiting, snoozed} lists) --- */

async function send(type, extra = {}) {
  const refresh = document.getElementById('refresh');
  refresh.disabled = true;
  refresh.textContent = type === 'run-sweep' ? '↻ Sweeping…' : '↻ Refresh';
  try {
    const res = await chrome.runtime.sendMessage({ type, ...extra });
    if (res?.ok) render(res);
    else countEl.textContent = '!';
  } catch {
    countEl.textContent = '!';
  } finally {
    refresh.disabled = false;
    refresh.textContent = '↻ Refresh';
  }
}

document.getElementById('refresh').addEventListener('click', () => send('run-sweep'));
document.getElementById('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

send('get-waiting'); // fast initial paint
