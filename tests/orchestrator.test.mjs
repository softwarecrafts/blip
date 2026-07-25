import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChromeStub } from './helpers/chrome-stub.mjs';
import { makeFakeAdapter, conv } from './helpers/fake-adapter.mjs';
import { createOrchestrator } from '../extension/lib/orchestrator.js';

const WAITING = '🔴 Waiting on you: your move';
const RESOLVED = '✅ Resolved — safe to archive this chat.';

/** Settings with every platform in `ids` switched on. */
function settings(ids, extra = {}) {
  return {
    enabled: true,
    mirrorStar: false,
    pollMinutes: 10,
    platforms: Object.fromEntries(ids.map((id) => [id, true])),
    ...extra,
  };
}

// ── seen-cache migration ────────────────────────────────────────────────────

test('sweep: discards the old flat seen shape', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat one')]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { c1: '2026-07-01T00:00:00Z' }, // old flat shape: string values
  });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.deepEqual(Object.keys(chrome.store.seen), ['claude']);
  assert.equal(a.calls.get.length, 1, 'migration must force a re-check');
});

test('sweep: preserves an existing namespaced seen shape', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat one')]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { c1: '2026-07-01T00:00:00Z' } },
  });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(a.calls.get.length, 0, 'unchanged conversation must not be re-fetched');
});

test('sweep: namespaces seen per platform', async () => {
  const a = makeFakeAdapter('alpha', [conv('x1', 'Alpha chat')]);
  const b = makeFakeAdapter('beta', [conv('y1', 'Beta chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['alpha', 'beta']) });
  await createOrchestrator({ adapters: { alpha: a, beta: b } }).sweep();

  assert.deepEqual(Object.keys(chrome.store.seen).sort(), ['alpha', 'beta']);
  assert.deepEqual(Object.keys(chrome.store.seen.alpha), ['x1']);
  assert.deepEqual(Object.keys(chrome.store.seen.beta), ['y1']);
});

// ── error isolation and badge states ────────────────────────────────────────

test('sweep: one adapter failing does not stop the others', async () => {
  const bad = makeFakeAdapter('alpha', [conv('x1', 'Alpha')], { listThrows: true });
  const good = makeFakeAdapter('beta', [conv('y1', `${WAITING} chat`)]);
  globalThis.chrome = makeChromeStub({ settings: settings(['alpha', 'beta']) });
  await createOrchestrator({ adapters: { alpha: bad, beta: good } }).sweep();

  assert.equal(good.calls.list, 1, 'healthy adapter still swept');
  assert.equal(chrome.badge.color, '#e23f33', 'partial failure is not the failure badge');
});

test('sweep: every adapter failing shows the failure badge', async () => {
  const bad = makeFakeAdapter('claude', [conv('c1', 'Chat')], { listThrows: true });
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: bad } }).sweep();

  assert.equal(chrome.badge.text, '!');
  assert.equal(chrome.badge.color, '#777');
});

test('sweep: zero enabled platforms clears the badge, not an error state', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings([]) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '');
  assert.notEqual(chrome.badge.color, '#777');
  assert.equal(a.calls.list, 0);
});

test('sweep: master switch off touches nothing', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude'], { enabled: false }) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '');
  assert.equal(a.calls.list, 0);
  assert.equal(a.calls.get.length, 0);
});

test('sweep: badge counts waiting chats', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'One', { lastAssistantText: WAITING }),
    conv('c2', 'Two', { lastAssistantText: RESOLVED }),
    conv('c3', 'Three', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '2');
});

// ── rename behaviour ────────────────────────────────────────────────────────

test('sweep: renames a waiting chat and converges on the second pass', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Plan the launch', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a } });

  await o.sweep();
  assert.deepEqual(a.calls.rename, [['c1', '🔴 Plan the launch']]);

  await o.sweep();
  assert.equal(a.calls.rename.length, 1, 'second sweep must not rename again');
});

test('sweep: a chat with no marker is never renamed', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Plan the launch', { lastAssistantText: 'no marker here' }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.deepEqual(a.calls.rename, []);
});

test('sweep: mirrorStar is skipped when the adapter lacks the capability', async () => {
  const withStar = makeFakeAdapter('alpha', [conv('x1', 'A', { lastAssistantText: WAITING })]);
  const noStar = makeFakeAdapter('beta', [conv('y1', 'B', { lastAssistantText: WAITING })], {
    capabilities: {},
  });
  globalThis.chrome = makeChromeStub({
    settings: settings(['alpha', 'beta'], { mirrorStar: true }),
  });
  await createOrchestrator({ adapters: { alpha: withStar, beta: noStar } }).sweep();

  assert.deepEqual(withStar.calls.setStarred, [['x1', true]]);
  assert.deepEqual(noStar.calls.setStarred, []);
});

// ── seen pruning ────────────────────────────────────────────────────────────

test('sweep: prunes seen entries for chats that left the list window', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'One'), conv('c2', 'Two')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a } });

  await o.sweep();
  assert.deepEqual(Object.keys(chrome.store.seen.claude).sort(), ['c1', 'c2']);

  a.drop('c2');
  await o.sweep();
  assert.deepEqual(Object.keys(chrome.store.seen.claude), ['c1']);
});

// ── checkConversation ───────────────────────────────────────────────────────

test('checkConversation: returns null and calls nothing for a disabled platform', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings([]) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation(
    'claude',
    'c1'
  );

  assert.equal(name, null);
  assert.equal(a.calls.get.length, 0);
});

test('checkConversation: returns null for an unknown platform', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude', 'ghost']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation(
    'ghost',
    'c1'
  );

  assert.equal(name, null);
});

test('checkConversation: renames and records the chat in seen', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Plan', { lastAssistantText: WAITING })]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation(
    'claude',
    'c1'
  );

  assert.equal(name, '🔴 Plan');
  assert.deepEqual(Object.keys(chrome.store.seen.claude), ['c1']);
});

test('checkConversation: leaves a temporary chat completely alone', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Temp', { isTemporary: true, lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation(
    'claude',
    'c1'
  );

  assert.equal(name, 'Temp');
  assert.deepEqual(a.calls.rename, []);
});

// ── listWaiting ─────────────────────────────────────────────────────────────

test('listWaiting: returns only 🔴 chats, with adapter-supplied URLs', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Waiting one'),
    conv('c2', '✅ Done'),
    conv('c3', 'Untouched'),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const { waiting } = await createOrchestrator({ adapters: { claude: a } }).listWaiting();

  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, 'c1');
  assert.equal(waiting[0].url, 'https://claude.test/chat/c1');
  assert.equal(waiting[0].platform, 'claude');
});

test('listWaiting: master switch off returns an empty queue', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔴 Waiting one')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude'], { enabled: false }) });
  const { waiting } = await createOrchestrator({ adapters: { claude: a } }).listWaiting();

  assert.deepEqual(waiting, []);
  assert.equal(a.calls.list, 0);
});

test('listWaiting: a failing adapter yields an empty queue, not a throw', async () => {
  const bad = makeFakeAdapter('claude', [conv('c1', '🔴 Waiting')], { listThrows: true });
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const { waiting } = await createOrchestrator({ adapters: { claude: bad } }).listWaiting();

  assert.deepEqual(waiting, []);
});
