import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChromeStub } from './helpers/chrome-stub.mjs';
import { makeFakeAdapter, conv } from './helpers/fake-adapter.mjs';
import { makeFakeSnoozeStore } from './helpers/fake-snooze-store.mjs';
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

// ── snooze integration ──────────────────────────────────────────────────────

const HOUR = 3_600_000;
const future = () => Date.now() + HOUR;
const past = () => Date.now() - 1000;

test('sweep: a snoozed waiting chat is titled 💤🔴, not 🔴', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Plan the launch', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).sweep();

  assert.deepEqual(a.calls.rename, [['c1', '💤🔴 Plan the launch']]);
});

test('sweep: snoozed chats are kept off the badge', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'One', { lastAssistantText: WAITING }),
    conv('c2', 'Two', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c2: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).sweep();

  assert.equal(chrome.badge.text, '1', 'only the unsnoozed chat counts');
});

test('sweep: an expired snooze strips the 💤 even though updatedAt is unchanged', async () => {
  // The regression this guards: `seen` short-circuits on updatedAt, but a
  // snooze expiring changes nothing server-side — so without the staleness
  // check the 💤 would survive on a quiet chat forever.
  const a = makeFakeAdapter('claude', [
    conv('c1', '💤🔴 Plan the launch', { lastAssistantText: WAITING, updatedAt: 'T0' }),
  ]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { c1: 'T0' } }, // would otherwise skip the fetch entirely
  });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: past() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).sweep();

  assert.deepEqual(a.calls.rename, [['c1', '🔴 Plan the launch']]);
  assert.equal(chrome.badge.text, '1', 'and it comes back onto the badge');
});

test('sweep: a title that agrees with the schedule is not re-fetched', async () => {
  // The other half of the staleness check: it must not defeat the seen cache
  // for every snoozed chat on every sweep.
  const a = makeFakeAdapter('claude', [
    conv('c1', '💤🔴 Plan the launch', { lastAssistantText: WAITING, updatedAt: 'T0' }),
  ]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { c1: 'T0' } },
  });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).sweep();

  assert.equal(a.calls.get.length, 0, 'no wasted fetch while the 💤 is correct');
  assert.deepEqual(a.calls.rename, []);
});

test('sweep: resolving a snoozed chat drops its snooze', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '💤🔴 Plan the launch', { lastAssistantText: RESOLVED }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).sweep();

  assert.deepEqual(a.calls.rename, [['c1', '✅ Plan the launch']]);
  assert.deepEqual(snoozeStore.peek(), {}, '✅ cancels a snooze');
});

test('sweep: a chat leaving the list window drops its snooze', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 One', { lastAssistantText: WAITING }),
    conv('c2', '🔴 Two', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future(), c2: future() } });
  const o = createOrchestrator({ adapters: { claude: a }, snoozeStore });

  await o.sweep();
  assert.deepEqual(Object.keys(snoozeStore.peek().claude).sort(), ['c1', 'c2']);

  a.drop('c2');
  await o.sweep();
  assert.deepEqual(Object.keys(snoozeStore.peek().claude), ['c1']);
});

test('listWaiting: splits the queue into waiting and snoozed with wake times', async () => {
  const wake = future();
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Awake'),
    conv('c2', '💤🔴 Sleeping'),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c2: wake } });
  const { waiting, snoozed } = await createOrchestrator({
    adapters: { claude: a },
    snoozeStore,
  }).listWaiting();

  assert.deepEqual(waiting.map((i) => i.id), ['c1']);
  assert.deepEqual(snoozed.map((i) => i.id), ['c2']);
  assert.equal(snoozed[0].wakeAt, wake);
  assert.equal(snoozed[0].url, 'https://claude.test/chat/c2', 'snoozed rows are still links');
});

test('listWaiting: an expired snooze is already back under waiting', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '💤🔴 Sleeping')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: past() } });
  const { waiting, snoozed } = await createOrchestrator({
    adapters: { claude: a },
    snoozeStore,
  }).listWaiting();

  assert.deepEqual(waiting.map((i) => i.id), ['c1']);
  assert.deepEqual(snoozed, []);
});

test('listWaiting: a failing adapter does not lose its snoozes', async () => {
  const good = makeFakeAdapter('alpha', [conv('x1', '🔴 Alpha')]);
  const bad = makeFakeAdapter('beta', [conv('y1', '🔴 Beta')], { listThrows: true });
  globalThis.chrome = makeChromeStub({ settings: settings(['alpha', 'beta']) });
  const snoozeStore = makeFakeSnoozeStore({ beta: { y1: future() } });
  await createOrchestrator({ adapters: { alpha: good, beta: bad }, snoozeStore }).listWaiting();

  assert.ok(snoozeStore.peek().beta?.y1, 'a list() failure must not read as "not waiting"');
});

test('snooze/unsnooze decorate the title immediately, not at next sweep', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Plan the launch', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore();
  const o = createOrchestrator({ adapters: { claude: a }, snoozeStore });

  await o.snooze('claude', 'c1', future());
  assert.deepEqual(a.calls.rename.at(-1), ['c1', '💤🔴 Plan the launch']);

  await o.unsnooze('claude', 'c1');
  assert.deepEqual(a.calls.rename.at(-1), ['c1', '🔴 Plan the launch']);
});

test('snooze refuses a wake time in the past', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔴 Plan')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a } });

  await assert.rejects(() => o.snooze('claude', 'c1', past()), /future/);
});

test('badge follows a snooze immediately, without waiting for a sweep', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'One', { lastAssistantText: WAITING }),
    conv('c2', 'Two', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore();
  const o = createOrchestrator({ adapters: { claude: a }, snoozeStore });

  await o.sweep();
  assert.equal(chrome.badge.text, '2');

  // Exactly what background.js chains after the popup's snooze message.
  await o.snooze('claude', 'c1', future());
  await o.listWaiting();
  assert.equal(chrome.badge.text, '1', 'snoozed chats must leave the count at once');

  await o.unsnooze('claude', 'c1');
  await o.listWaiting();
  assert.equal(chrome.badge.text, '2', 'and come back on wake-now');
});

test('badge clears when every waiting chat is snoozed', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔴 Only one')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).listWaiting();

  assert.equal(chrome.badge.text, '', 'no number rather than a 0');
});

test('opening the popup re-syncs a badge left stale by an expired snooze', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '💤🔴 Sleeping')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: past() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).listWaiting();

  assert.equal(chrome.badge.text, '1', 'expiry counts again the moment we look');
});

test('listWaiting counts snoozed chats out, not 🔴 titles out', async () => {
  // A snoozed chat still wears 🔴 (as 💤🔴) — the badge must key off the
  // schedule, not off the title losing its dot.
  const a = makeFakeAdapter('claude', [
    conv('c1', '💤🔴 Sleeping'),
    conv('c2', '🔴 Awake'),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  const { waiting, snoozed } = await createOrchestrator({
    adapters: { claude: a },
    snoozeStore,
  }).listWaiting();

  assert.equal(chrome.badge.text, '1');
  assert.equal(waiting.length, 1);
  assert.equal(snoozed.length, 1, 'still listed, just not counted');
});

// ── seed depth: never-seen chats below the depth are recorded, not fetched ──

/** N unmarked filler conversations, in list order. */
function filler(n) {
  return Array.from({ length: n }, (_, i) => conv(`f${i}`, `Filler ${i}`));
}

test('sweep: a never-seen chat below SEED_DEPTH is recorded without a get()', async () => {
  const deep = conv('deep', 'An old chat', { lastAssistantText: WAITING });
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.ok(!a.calls.get.includes('deep'), 'must not fetch a chat below the seed depth');
  assert.equal(chrome.store.seen.claude.deep, deep.updatedAt, 'must still be recorded as seen');
  assert.deepEqual(a.calls.rename, [], 'and must not be renamed');
});

test('sweep: a deep chat already titled 🔴 still counts toward the badge', async () => {
  const deep = conv('deep', '🔴 Old blip');
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.equal(chrome.badge.text, '1', 'skipping the fetch must not skip the count');
  assert.ok(!a.calls.get.includes('deep'));
});

test('sweep: a never-seen chat above SEED_DEPTH is still fetched and renamed', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Chat one', { lastAssistantText: WAITING }),
    ...filler(60),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.deepEqual(a.calls.rename, [['c1', '🔴 Chat one']]);
});

test('sweep: a SEEN chat below SEED_DEPTH whose updatedAt changed is still fetched', async () => {
  // The rule keys off "never seen", not depth alone — a chat we are already
  // tracking must keep converging no matter how far it has drifted down.
  const deep = conv('deep', 'Old chat', { updatedAt: 'T2', lastAssistantText: WAITING });
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { deep: 'T1' } },
  });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.ok(a.calls.get.includes('deep'));
  assert.deepEqual(a.calls.rename, [['deep', '🔴 Old chat']]);
});

// ── ignore integration (the 🔕 prefix, off the radar) ───────────────────────

test('sweep: an ignored chat is left alone — no get(), no rename', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔕 Weight log')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  }).sweep();

  assert.deepEqual(a.calls.get, [], 'ignore is read from the listed title, never fetched');
  assert.deepEqual(a.calls.rename, []);
  assert.equal(chrome.store.seen.claude.c1, '2026-07-01T00:00:00Z', 'still recorded as seen');
});

test('sweep: a fresh 🔴 marker on an ignored chat never re-labels it', async () => {
  // The whole point: an ongoing log keeps drawing 🔴 markers, but 🔕 wins.
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔕 Weight log', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  }).sweep();

  assert.deepEqual(a.calls.rename, [], 'the 🔴 in the reply must not reach the title');
  assert.equal(chrome.badge.text, '', 'and it never counts toward the badge');
});

test('sweep: ignored chats are kept off the badge', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔕 Weight log', { lastAssistantText: WAITING }),
    conv('c2', 'Plan the launch', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  }).sweep();

  assert.equal(chrome.badge.text, '1', 'only the tracked chat counts');
  assert.deepEqual(a.calls.rename, [['c2', '🔴 Plan the launch']]);
});

test('sweep: a stacked 🔕🔴 title is normalised to a clean 🔕', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔕🔴 Weight log')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  }).sweep();

  assert.deepEqual(a.calls.rename, [['c1', '🔕 Weight log']]);
  assert.deepEqual(a.calls.get, [], 'still no fetch — the title is all we need');
});

test('listWaiting: ignored chats go in their own section, off the queue and badge', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Plan the launch'),
    conv('c2', '🔕 Weight log'),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const { waiting, snoozed, ignored } = await createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  }).listWaiting();

  assert.deepEqual(waiting.map((i) => i.id), ['c1']);
  assert.deepEqual(snoozed, []);
  assert.deepEqual(ignored.map((i) => i.id), ['c2']);
  assert.equal(ignored[0].url, 'https://claude.test/chat/c2', 'ignored rows are still links');
  assert.equal(chrome.badge.text, '1', 'ignored chats never reach the count');
});

test('listWaiting: ignoring a snoozed chat drops its snooze', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔕 Weight log')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const snoozeStore = makeFakeSnoozeStore({ claude: { c1: future() } });
  await createOrchestrator({ adapters: { claude: a }, snoozeStore }).listWaiting();

  assert.deepEqual(snoozeStore.peek(), {}, 'a chat off the radar has no reason to stay snoozed');
});

test('ignore/unignore rewrite the title immediately, not at next sweep', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Plan the launch', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a }, snoozeStore: makeFakeSnoozeStore() });

  await o.ignore('claude', 'c1');
  assert.deepEqual(a.calls.rename.at(-1), ['c1', '🔕 Plan the launch']);

  await o.unignore('claude', 'c1');
  assert.deepEqual(a.calls.rename.at(-1), ['c1', '🔴 Plan the launch'], 'the live 🔴 marker is restored');
});
