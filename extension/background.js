/**
 * background.js — Chrome event wiring.
 *
 * This file translates Chrome's event surface into orchestrator calls and
 * does nothing else. All classify/rename/sweep logic lives in
 * lib/orchestrator.js; all platform specifics live in adapters/*.
 */
import { getSettings } from './lib/settings.js';
import { createOrchestrator } from './lib/orchestrator.js';

const { sweep, checkConversation, listWaiting } = createOrchestrator();

chrome.runtime.onInstalled.addListener(async (details) => {
  await resetAlarm();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  sweep();
});
chrome.runtime.onStartup.addListener(() => {
  resetAlarm();
  sweep();
});
chrome.alarms.onAlarm.addListener((a) => a.name === 'sweep' && sweep());

// Recreate the alarm when the poll cadence (or any setting) changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) resetAlarm();
});

async function resetAlarm() {
  const { pollMinutes } = await getSettings();
  chrome.alarms.create('sweep', { periodInMinutes: Math.max(1, pollMinutes) });
}

// Messages from content.js (instant re-check) and popup.js (UI queries).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    'check-conversation': () => checkConversation(msg.platform, msg.id).then((name) => ({ name })),
    'get-waiting': () => listWaiting(),
    'run-sweep': () => sweep().then(() => listWaiting()),
  };
  const handler = handlers[msg?.type];
  if (!handler) return;
  handler()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});
