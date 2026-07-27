import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../extension/lib/paginate.js';

/**
 * Fake page source over a fixed array, recording the calls it received.
 * Mirrors the real endpoint: slicing past the end yields a short/empty page.
 */
function pageSource(items) {
  const calls = [];
  return {
    calls,
    fetchPage: async ({ offset, limit }) => {
      calls.push({ offset, limit });
      return items.slice(offset, offset + limit);
    },
  };
}

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

test('paginate: stops at the first short page', async () => {
  const src = pageSource(items(187));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 187);
  assert.equal(out[0].id, 'c0');
  assert.equal(out[186].id, 'c186');
  assert.deepEqual(src.calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
  ]);
});

test('paginate: an exactly-full final page costs one extra empty request', async () => {
  // The endpoint gives no total, so a full last page is indistinguishable from
  // "more to come" — the walker MUST ask again and stop on the empty page.
  const src = pageSource(items(200));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 200);
  assert.equal(src.calls.length, 3);
  assert.deepEqual(src.calls[2], { offset: 200, limit: 100 });
});

test('paginate: a single short page issues exactly one request', async () => {
  const src = pageSource(items(12));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 12);
  assert.equal(src.calls.length, 1);
});

test('paginate: an empty first page returns empty and stops', async () => {
  const src = pageSource([]);
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.deepEqual(out, []);
  assert.equal(src.calls.length, 1);
});

test('paginate: respects maxPages and warns when the cap is hit', async () => {
  const src = pageSource(items(1000));
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 3 });
    assert.equal(out.length, 300);
    assert.equal(src.calls.length, 3);
  } finally {
    console.warn = realWarn;
  }
  // The cap silently truncating history would be invisible in production.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /page cap/i);
});
