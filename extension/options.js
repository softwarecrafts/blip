/**
 * options.js — binds the settings form to chrome.storage via lib/settings.js.
 * Changes save immediately (no save button); the background worker picks up
 * cadence changes through its storage.onChanged listener.
 */
import { getSettings, setSettings } from './lib/settings.js';

const fields = {
  enabled: document.getElementById('enabled'),
  mirrorStar: document.getElementById('mirrorStar'),
  pollMinutes: document.getElementById('pollMinutes'),
};
const savedEl = document.getElementById('saved');
let savedTimer = null;

function flashSaved() {
  savedEl.textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.textContent = ''), 1500);
}

async function init() {
  const s = await getSettings();
  fields.enabled.checked = s.enabled;
  fields.mirrorStar.checked = s.mirrorStar;
  fields.pollMinutes.value = s.pollMinutes;
}

fields.enabled.addEventListener('change', async (e) => {
  await setSettings({ enabled: e.target.checked });
  flashSaved();
});
fields.mirrorStar.addEventListener('change', async (e) => {
  await setSettings({ mirrorStar: e.target.checked });
  flashSaved();
});
fields.pollMinutes.addEventListener('change', async (e) => {
  const n = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 10));
  e.target.value = n;
  await setSettings({ pollMinutes: n });
  flashSaved();
});
document.getElementById('setup').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
});

init();
