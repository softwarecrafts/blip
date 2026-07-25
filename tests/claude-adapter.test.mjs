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
