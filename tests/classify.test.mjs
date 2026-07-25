import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../extension/lib/classify.js';

test('classify: 🔴 marker -> waiting', () => {
  assert.equal(classify('Some reply.\n\n🔴 Waiting on you: pick a name'), 'waiting');
});

test('classify: ✅ marker -> resolved', () => {
  assert.equal(classify('All done.\n\n✅ Resolved — safe to archive this chat.'), 'resolved');
});

test('classify: no marker -> null', () => {
  assert.equal(classify('Just a normal reply with no status line.'), null);
});

test('classify: empty or missing text -> null', () => {
  assert.equal(classify(''), null);
  assert.equal(classify(undefined), null);
});

test('classify: tolerates trailing artifacts after the marker', () => {
  const text = 'Reply.\n\n🔴 Waiting on you: decide\n\nEdit\nRetry';
  assert.equal(classify(text), 'waiting');
});

test('classify: reads the LAST marker when a reply quotes an earlier one', () => {
  const text = '🔴 Waiting on you: old\n\nActually done now.\n\n✅ Resolved — safe to archive this chat.';
  assert.equal(classify(text), 'resolved');
});
