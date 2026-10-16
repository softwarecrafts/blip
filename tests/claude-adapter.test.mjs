import test from 'node:test';
import assert from 'node:assert/strict';
import { lastAssistantText } from '../extension/adapters/claude.js';

test('lastAssistantText: returns the final assistant message', () => {
  const full = {
    chat_messages: [
      { sender: 'assistant', text: 'first' },
      { sender: 'human', text: 'a question' },
      { sender: 'assistant', text: 'second' },
    ],
  };
  assert.equal(lastAssistantText(full), 'second');
});

test('lastAssistantText: ignores a trailing human turn', () => {
  const full = {
    chat_messages: [
      { sender: 'assistant', text: 'the answer' },
      { sender: 'human', text: 'thanks' },
    ],
  };
  assert.equal(lastAssistantText(full), 'the answer');
});

test('lastAssistantText: missing chat_messages -> empty string', () => {
  assert.equal(lastAssistantText({}), '');
});

test('lastAssistantText: no assistant turns -> empty string', () => {
  assert.equal(lastAssistantText({ chat_messages: [{ sender: 'human', text: 'hi' }] }), '');
});

test('lastAssistantText: assistant message with no text field -> empty string', () => {
  assert.equal(lastAssistantText({ chat_messages: [{ sender: 'assistant' }] }), '');
});

// ── shape tolerance: claude.ai changes its responses without notice ─────────

import {
  messageText,
  currentBranch,
  isUnreadable,
  unwrapList,
  claudeAdapter,
} from '../extension/adapters/claude.js';
import { makeChromeStub } from './helpers/chrome-stub.mjs';

test('lastAssistantText: reads text from content blocks when `text` is empty', () => {
  const full = {
    chat_messages: [
      {
        sender: 'assistant',
        text: '',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Reply.' },
          { type: 'tool_use', name: 'x', input: {} },
          { type: 'text', text: '🔴 Waiting on you: decide' },
        ],
      },
    ],
  };
  assert.equal(lastAssistantText(full), 'Reply.\n🔴 Waiting on you: decide');
});

test('messageText: accepts role/content-string shapes', () => {
  assert.equal(messageText({ role: 'assistant', content: 'plain' }), 'plain');
  assert.equal(messageText({ content: [{ text: 'untyped block' }] }), 'untyped block');
  assert.equal(messageText({}), '');
});

test('lastAssistantText: accepts `role` instead of `sender`', () => {
  const full = { chat_messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }] };
  assert.equal(lastAssistantText(full), 'hi');
});

test('currentBranch: follows current_leaf_message_uuid over array order', () => {
  const full = {
    current_leaf_message_uuid: 'a1',
    chat_messages: [
      { uuid: 'h1', parent_message_uuid: 'root', sender: 'human', text: 'q' },
      { uuid: 'a1', parent_message_uuid: 'h1', sender: 'assistant', text: 'live branch' },
      { uuid: 'a2', parent_message_uuid: 'h1', sender: 'assistant', text: 'abandoned retry' },
    ],
  };
  assert.deepEqual(currentBranch(full).map((m) => m.uuid), ['h1', 'a1']);
  assert.equal(lastAssistantText(full), 'live branch');
});

test('currentBranch: falls back to index order', () => {
  const full = {
    chat_messages: [
      { index: 1, sender: 'assistant', text: 'second' },
      { index: 0, sender: 'assistant', text: 'first' },
    ],
  };
  assert.equal(lastAssistantText(full), 'second');
});

test('isUnreadable: assistant replies with no extractable text', () => {
  assert.equal(isUnreadable({ chat_messages: [{ sender: 'assistant', blob: '?' }] }), true);
  assert.equal(isUnreadable({}), true, 'missing message array');
  assert.equal(isUnreadable({ chat_messages: [] }), false, 'empty chat is fine');
  assert.equal(isUnreadable({ chat_messages: [{ sender: 'assistant', text: 'ok' }] }), false);
});

test('unwrapList: bare arrays and common wrappers', () => {
  assert.deepEqual(unwrapList([1]), [1]);
  assert.deepEqual(unwrapList({ data: [2] }), [2]);
  assert.deepEqual(unwrapList({ conversations: [3] }), [3]);
  assert.throws(() => unwrapList({ nope: true }), /expected a list/);
});

// ── network fallbacks, against a scripted fetch ─────────────────────────────

/** Script fetch: each route is [method, urlSubstring, status, body]. */
function scriptFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.replace('https://claude.ai/api', '')}`);
    const hit = routes.find(([m, frag]) => m === method && url.includes(frag));
    const [, , status, body] = hit ?? [null, null, 404, null];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
    };
  };
  return calls;
}

test('get: retries with rendering_mode when the bare response is unreadable', async () => {
  globalThis.chrome = makeChromeStub();
  chrome.store['claude:orgId'] = 'org';
  const calls = scriptFetch([
    ['GET', 'rendering_mode=messages', 200, {
      uuid: 'c1', name: 'Chat',
      chat_messages: [{ sender: 'assistant', content: [{ type: 'text', text: '✅ Resolved' }] }],
    }],
    ['GET', '/chat_conversations/c1', 200, { uuid: 'c1', name: 'Chat' }],
  ]);
  const conv = await claudeAdapter.get('c1');
  assert.equal(conv.lastAssistantText, '✅ Resolved');
  assert.equal(conv.unreadable, false);
  assert.equal(calls.length, 2);
});

test('rename: falls back to PATCH when PUT is gone', async () => {
  globalThis.chrome = makeChromeStub();
  chrome.store['claude:orgId'] = 'org';
  const calls = scriptFetch([
    ['PUT', '/chat_conversations/c1', 405, null],
    ['PATCH', '/chat_conversations/c1', 200, { uuid: 'c1', name: '🔴 Chat' }],
  ]);
  await claudeAdapter.rename('c1', '🔴 Chat');
  assert.deepEqual(calls.map((c) => c.split(' ')[0]), ['PUT', 'PATCH']);
});

test('rename: a 204 with no body counts as success', async () => {
  globalThis.chrome = makeChromeStub();
  chrome.store['claude:orgId'] = 'org';
  const calls = scriptFetch([['PUT', '/chat_conversations/c1', 204, null]]);
  await claudeAdapter.rename('c1', '🔴 Chat');
  assert.equal(calls.length, 1);
});

test('rename: throws when the server silently ignores the new name', async () => {
  globalThis.chrome = makeChromeStub();
  chrome.store['claude:orgId'] = 'org';
  scriptFetch([
    ['PUT', '/chat_conversations/c1', 200, { uuid: 'c1', name: 'Chat' }],
    ['PATCH', '/chat_conversations/c1', 200, { uuid: 'c1', name: 'Chat' }],
  ]);
  await assert.rejects(claudeAdapter.rename('c1', '🔴 Chat'), /server ignored name/);
});

test('list: a stale cached org id is dropped and re-resolved', async () => {
  globalThis.chrome = makeChromeStub();
  chrome.store['claude:orgId'] = 'old-org';
  scriptFetch([
    ['GET', '/organizations/old-org/', 403, null],
    ['GET', '/organizations/new-org/chat_conversations?', 200, { data: [{ uuid: 'c1', name: 'Chat' }] }],
    ['GET', '/organizations', 200, [{ uuid: 'new-org', capabilities: ['chat'] }]],
  ]);
  const list = await claudeAdapter.list();
  assert.deepEqual(list.map((c) => c.id), ['c1']);
  assert.equal(chrome.store['claude:orgId'], 'new-org');
});
