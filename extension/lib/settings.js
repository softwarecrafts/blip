/**
 * User settings, backed by chrome.storage.local under the "settings" key.
 * Defaults are merged in on every read, so adding a new setting here is
 * backward-compatible with existing installs (missing keys fall back).
 */
export const DEFAULT_SETTINGS = {
  enabled: true, // master on/off for the whole extension
  mirrorStar: false, // 🔴 -> star the chat, ✅ -> unstar (off: stars stay yours)
  pollMinutes: 10, // background sweep cadence
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
