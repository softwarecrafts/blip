import test from 'node:test';
import assert from 'node:assert/strict';
import { titleTransform, stripPrefix, isIgnored } from '../extension/lib/titleTransform.js';

test('titleTransform: null status leaves the title untouched', () => {
  assert.equal(titleTransform('Plan the launch', null), 'Plan the launch');
  assert.equal(titleTransform('🔴 Plan the launch', null), '🔴 Plan the launch');
});

test('titleTransform: adds the waiting prefix', () => {
  assert.equal(titleTransform('Plan the launch', 'waiting'), '🔴 Plan the launch');
});

test('titleTransform: adds the resolved prefix', () => {
  assert.equal(titleTransform('Plan the launch', 'resolved'), '✅ Plan the launch');
});

test('titleTransform: swaps an existing prefix rather than stacking', () => {
  assert.equal(titleTransform('🔴 Plan the launch', 'resolved'), '✅ Plan the launch');
  assert.equal(titleTransform('✅ Plan the launch', 'waiting'), '🔴 Plan the launch');
});

test('titleTransform: is idempotent (the sweep depends on this)', () => {
  for (const status of ['waiting', 'resolved']) {
    const once = titleTransform('Plan the launch', status);
    assert.equal(titleTransform(once, status), once);
  }
});

test('stripPrefix: removes stacked prefixes left by any earlier bug', () => {
  assert.equal(stripPrefix('🔴 ✅ 🔴 Plan the launch'), 'Plan the launch');
});

/* --- snooze: the 💤🔴 prefix (see snooze.js) --- */

test('stripPrefix: removes the compound 💤🔴 whole, not just the 🔴', () => {
  assert.equal(stripPrefix('💤🔴 Plan the launch'), 'Plan the launch');
  assert.equal(stripPrefix('💤🔴Plan the launch'), 'Plan the launch'); // no-space variant
});

test('titleTransform: null status is untouched even with a stale snooze', () => {
  assert.equal(titleTransform('Plan the launch', null, true), 'Plan the launch');
});

test('titleTransform: a snoozed waiting chat is 💤🔴 — still red', () => {
  assert.equal(titleTransform('Plan the launch', 'waiting', true), '💤🔴 Plan the launch');
});

test('titleTransform: snooze transitions swap the whole prefix both ways', () => {
  assert.equal(titleTransform('🔴 Plan the launch', 'waiting', true), '💤🔴 Plan the launch');
  assert.equal(titleTransform('💤🔴 Plan the launch', 'waiting', false), '🔴 Plan the launch');
});

test('titleTransform: resolved wins over snooze', () => {
  assert.equal(titleTransform('💤🔴 Plan the launch', 'resolved', true), '✅ Plan the launch');
});

test('titleTransform: idempotent for every status × snoozed combination', () => {
  for (const status of ['waiting', 'resolved', null]) {
    for (const snoozed of [false, true]) {
      const once = titleTransform('💤🔴 Plan the launch', status, snoozed);
      assert.equal(titleTransform(once, status, snoozed), once, `${status}/${snoozed}`);
    }
  }
});

/* --- ignore: the 🔕 prefix (off the radar) --- */

test('isIgnored: true only for a 🔕 title', () => {
  assert.equal(isIgnored('🔕 Weight log'), true);
  assert.equal(isIgnored('🔕Weight log'), true); // no-space variant
  assert.equal(isIgnored('  🔕 Weight log'), true); // leading whitespace
  assert.equal(isIgnored('🔴 Plan the launch'), false);
  assert.equal(isIgnored('Weight log'), false);
});

test('stripPrefix: removes 🔕, alone and stacked over a status', () => {
  assert.equal(stripPrefix('🔕 Weight log'), 'Weight log');
  assert.equal(stripPrefix('🔕🔴 Weight log'), 'Weight log');
  assert.equal(stripPrefix('🔴 🔕 Weight log'), 'Weight log');
});

test('titleTransform: ignored wins over every status and snooze', () => {
  for (const status of ['waiting', 'resolved', null]) {
    for (const snoozed of [false, true]) {
      assert.equal(
        titleTransform('Weight log', status, snoozed, true),
        '🔕 Weight log',
        `${status}/${snoozed}`
      );
    }
  }
});

test('titleTransform: ignoring strips any existing status prefix', () => {
  assert.equal(titleTransform('🔴 Weight log', 'waiting', false, true), '🔕 Weight log');
  assert.equal(titleTransform('💤🔴 Weight log', 'waiting', true, true), '🔕 Weight log');
  assert.equal(titleTransform('✅ Weight log', 'resolved', false, true), '🔕 Weight log');
});

test('titleTransform: idempotent for every status × snoozed × ignored combination', () => {
  for (const status of ['waiting', 'resolved', null]) {
    for (const snoozed of [false, true]) {
      for (const ignored of [false, true]) {
        const start = ignored ? '🔕 Weight log' : '💤🔴 Weight log';
        const once = titleTransform(start, status, snoozed, ignored);
        assert.equal(
          titleTransform(once, status, snoozed, ignored),
          once,
          `${status}/${snoozed}/${ignored}`
        );
      }
    }
  }
});
