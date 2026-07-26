import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnoozeStore, WAKE_ALARM } from '../extension/lib/snoozeStore.js';

const HOUR = 3_600_000;
const future = (n = 1) => Date.now() + n * HOUR;
const past = () => Date.now() - 1000;

/**
 * The store takes its storage and alarms injected, so these tests need no
 * chrome stub at all — just two recording fakes.
 */
function harness(snoozes) {
  const store = snoozes === undefined ? {} : { snoozes };
  const log = { created: [], cleared: [] };
  return {
    log,
    peek: () => store.snoozes,
    writes: () => log.created.length + log.cleared.length,
    subject: createSnoozeStore({
      storage: {
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        async set(obj) {
          Object.assign(store, structuredClone(obj));
        },
      },
      alarms: {
        create(name, info) {
          log.created.push({ name, info });
        },
        async clear(name) {
          log.cleared.push(name);
        },
      },
    }),
  };
}

test('load: absent storage reads as an empty map', async () => {
  const h = harness();
  assert.deepEqual(await h.subject.load(), {});
});

test('snooze: persists the wake time and arms the alarm for it', async () => {
  const h = harness();
  const wake = future();
  await h.subject.snooze('claude', 'c1', wake);

  assert.equal(h.peek().claude.c1, wake);
  assert.deepEqual(h.log.created, [{ name: WAKE_ALARM, info: { when: wake } }]);
});

test('snooze: the alarm tracks the EARLIEST wake, not the latest write', async () => {
  const h = harness();
  const later = future(5);
  const sooner = future(1);
  await h.subject.snooze('claude', 'late', later);
  await h.subject.snooze('claude', 'soon', sooner);

  assert.equal(h.log.created.at(-1).info.when, sooner);
});

test('snooze: a wake time in the past or NaN is refused', async () => {
  const h = harness();
  await assert.rejects(() => h.subject.snooze('claude', 'c1', past()), /future/);
  await assert.rejects(() => h.subject.snooze('claude', 'c1', NaN), /future/);
  assert.equal(h.writes(), 0, 'a refused snooze must not touch the alarm');
});

test('unsnooze: clears the alarm once the last snooze goes', async () => {
  const h = harness();
  await h.subject.snooze('claude', 'c1', future());
  await h.subject.unsnooze('claude', 'c1');

  assert.deepEqual(h.peek(), {});
  assert.deepEqual(h.log.cleared, [WAKE_ALARM]);
});

test('unsnooze: re-arms to the next wake when others remain', async () => {
  const h = harness();
  const remaining = future(5);
  await h.subject.snooze('claude', 'soon', future(1));
  await h.subject.snooze('claude', 'late', remaining);
  await h.subject.unsnooze('claude', 'soon');

  assert.deepEqual(h.log.cleared, []);
  assert.equal(h.log.created.at(-1).info.when, remaining);
});

test('prune: a no-op prune does not write or re-arm', async () => {
  const wake = future();
  const h = harness({ claude: { c1: wake } });
  await h.subject.prune({ claude: new Set(['c1']) });

  assert.equal(h.writes(), 0, 'a quiet sweep must not churn storage or the alarm');
  assert.equal(h.peek().claude.c1, wake);
});

test('prune: an expiring snooze is written back and the alarm cleared', async () => {
  const h = harness({ claude: { c1: past() } });
  await h.subject.prune({ claude: new Set(['c1']) });

  assert.deepEqual(h.peek(), {});
  assert.deepEqual(h.log.cleared, [WAKE_ALARM]);
});
