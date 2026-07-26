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
import {
  availablePresets,
  presetWakeTime,
  formatWake,
  toDateValue,
  timeSlots,
  wakeFromParts,
  defaultPickerDate,
} from './lib/snooze.js';

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const snoozedEl = document.getElementById('snoozed');
const snoozedListEl = document.getElementById('snoozed-list');
const snoozedCountEl = document.getElementById('snoozed-count');
const panelEl = document.getElementById('snooze-panel');
const dateEl = document.getElementById('snooze-date');
const timeEl = document.getElementById('snooze-time');
const setEl = document.getElementById('snooze-set');

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

/**
 * Row icons are inline SVG, not emoji. 💤 and ⏰ are colour emoji: they paint
 * themselves in a fixed palette (💤 is dark navy) and ignore `color`, so on a
 * dark popup they were nearly invisible and no amount of theming could reach
 * them. These stroke themselves in currentColor, so they follow the light/dark
 * scheme like everything else.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  // Moon / sun: snoozing puts a chat to bed, waking it brings it back.
  snooze: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
  wake: [
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41' +
      'M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  ],
};

function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function rowButton(paths, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'row-btn';
  btn.appendChild(icon(paths));
  btn.title = title;
  btn.setAttribute('aria-label', title); // the icon carries no text now
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
      li.appendChild(rowButton(ICONS.snooze, 'Snooze', () => togglePanel(li, { platform, id })));
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
      li.appendChild(rowButton(ICONS.wake, 'Wake now', () => send('unsnooze', { platform, id })));
      return li;
    })
  );
}

/* --- snooze panel (one shared instance, moved under the clicked row) --- */

/**
 * Refill the time dropdown for whatever date is selected, keeping the chosen
 * slot if it survives. Past slots are dropped, so an empty list means the day
 * is over — Set is disabled rather than allowed to submit a time in the past.
 */
function refreshTimeOptions() {
  const wanted = timeEl.value;
  const slots = timeSlots(dateEl.value);
  timeEl.replaceChildren(
    ...(slots.length
      ? slots.map((value) => new Option(value, value, false, value === wanted))
      : [new Option('—', '')])
  );
  // With nothing explicitly selected the browser picks the first option, so
  // the soonest slot is ready to Set without touching the dropdown.
  timeEl.disabled = setEl.disabled = slots.length === 0;
}

function togglePanel(li, target) {
  if (sameChat(panelTarget, target) && !panelEl.hidden) return closePanel();
  panelTarget = target;
  // Reset the picker each open: "today" goes stale in a popup left sitting.
  dateEl.min = toDateValue(Date.now());
  dateEl.value = defaultPickerDate();
  timeEl.value = '';
  refreshTimeOptions();
  li.after(panelEl);
  panelEl.hidden = false;
}

function closePanel() {
  panelEl.hidden = true;
  panelTarget = null;
  document.body.appendChild(panelEl); // park it outside the list
}

// Built once: the popup is short-lived, so "available" is evaluated for the
// moment it opened. presetWakeTime is called at click time, not now, so the
// wake time is measured from when you actually chose it.
for (const { id, label } of availablePresets()) {
  const btn = document.createElement('button');
  btn.className = 'preset';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (panelTarget) send('snooze', { ...panelTarget, wakeAt: presetWakeTime(id) });
  });
  panelEl.insertBefore(btn, panelEl.querySelector('.custom-row'));
}

dateEl.addEventListener('change', refreshTimeOptions);

setEl.addEventListener('click', () => {
  if (!panelTarget || !dateEl.value || !timeEl.value) return;
  const wakeAt = wakeFromParts(dateEl.value, timeEl.value);
  // The dropdown only ever offers future slots, but the popup can sit open
  // long enough for the earliest of them to go stale.
  if (wakeAt <= Date.now()) return refreshTimeOptions();
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
