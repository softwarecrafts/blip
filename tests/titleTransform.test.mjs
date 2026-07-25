import test from 'node:test';
import assert from 'node:assert/strict';
import { titleTransform, stripPrefix } from '../extension/lib/titleTransform.js';

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
