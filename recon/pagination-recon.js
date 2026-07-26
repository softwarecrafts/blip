/**
 * Pagination recon for the bliptracker "history pagination" roadmap item.
 *
 * HOW TO RUN:
 *   1. Open https://claude.ai in Chrome (logged in).
 *   2. Open DevTools (Cmd+Option+J) -> Console tab.
 *   3. Paste this entire file and hit Enter.
 *   4. When it finishes, run: copyPaginationRecon()
 *      and paste the clipboard contents back into Claude Code.
 *
 * READ-ONLY. Issues GET requests only — nothing is renamed, starred, archived
 * or deleted. It installs no fetch spy and leaves no globals behind except
 * window.__pagerecon and window.copyPaginationRecon.
 *
 * What it answers:
 *   Q1  Is the list sorted by updated_at descending? (the whole design assumes it)
 *   Q2  Is `limit` capped server-side, and at what value?
 *   Q3  Does `offset` work, is it ignored, or does it error?
 *   Q4  Is there cursor/total metadata, or is the response a bare array?
 *   Q5  How deep does an out-of-range offset go before returning empty?
 *   Q6  How many conversations are there in total?
 *   Q7  What is the deepest position of a chat currently marked 🔴 / 💤🔴?
 *       (this is the number that says whether the window bug bites you TODAY)
 */
(async () => {
  const rec = { ranAt: new Date().toISOString(), probes: {}, answers: {} };
  window.__pagerecon = rec;

  const PAGE = 50;
  const MAX_PAGES = 40; // hard stop at 2000 conversations, to stay polite

  const get = async (label, url) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      const isArray = Array.isArray(body);
      rec.probes[label] = {
        url,
        status: res.status,
        envelope: isArray ? 'bare-array' : { type: typeof body, keys: body ? Object.keys(body) : [] },
        count: isArray ? body.length : null,
      };
      console.log(`✓ ${label}: HTTP ${res.status}`, rec.probes[label]);
      return body;
    } catch (e) {
      rec.probes[label] = { url, error: String(e) };
      console.warn(`✗ ${label} failed:`, e);
      return null;
    }
  };

  const rows = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.conversations ?? []));
  const ids = (b) => rows(b).map((c) => c.uuid ?? c.id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── org id ────────────────────────────────────────────────────────────────
  const orgs = await get('organizations', '/api/organizations');
  const org = (Array.isArray(orgs) ? orgs : []).find((o) => o.capabilities?.includes('chat')) ?? orgs?.[0];
  const orgId = org?.uuid;
  rec.orgId = orgId ? `${String(orgId).slice(0, 8)}…` : null; // truncated: not needed downstream
  if (!orgId) {
    console.error('No org id — stopping. Run copyPaginationRecon() and report back.');
    return;
  }
  const CONVOS = `/api/organizations/${orgId}/chat_conversations`;

  // ── Q1/Q2/Q4: baseline page + limit cap ───────────────────────────────────
  const p0 = await get('limit-50', `${CONVOS}?limit=${PAGE}`);
  const big = await get('limit-200', `${CONVOS}?limit=200`);
  const huge = await get('limit-1000', `${CONVOS}?limit=1000`);

  const stamps = rows(p0).map((c) => c.updated_at);
  const parsed = stamps.map((s) => Date.parse(s));
  rec.answers.sortedDescByUpdatedAt =
    parsed.length > 1 && parsed.every((t, i) => i === 0 || parsed[i - 1] >= t);
  rec.answers.limitCap = {
    asked50: rows(p0).length,
    asked200: rows(big).length,
    asked1000: rows(huge).length,
    note: 'if asked200 === 200 the cap is above 200; if it equals 50 the server clamps to 50',
  };
  rec.answers.sampleItemKeys = rows(p0)[0] ? Object.keys(rows(p0)[0]) : [];

  // ── Q3: does offset work? ─────────────────────────────────────────────────
  const p1 = await get('limit-50-offset-50', `${CONVOS}?limit=${PAGE}&offset=${PAGE}`);
  const a = new Set(ids(p0));
  const overlap = ids(p1).filter((id) => a.has(id));
  rec.answers.offset = {
    status: rec.probes['limit-50-offset-50']?.status,
    page1Count: rows(p1).length,
    overlapWithPage0: overlap.length,
    verdict:
      rows(p1).length === 0
        ? 'EMPTY — either fewer than 50 conversations, or offset is rejected'
        : overlap.length === 0
          ? 'WORKS — page 1 is disjoint from page 0'
          : overlap.length === rows(p1).length
            ? 'IGNORED — offset returned the same page again'
            : `PARTIAL — ${overlap.length} shared ids (list shifted mid-read, or offset is fuzzy)`,
  };

  // Cursor-style alternatives, in case offset is a dead end.
  const lastStamp = stamps[stamps.length - 1];
  await get('before-timestamp', `${CONVOS}?limit=${PAGE}&before=${encodeURIComponent(lastStamp ?? '')}`);
  await get('page-param', `${CONVOS}?limit=${PAGE}&page=2`);

  // ── Q5: out-of-range offset ───────────────────────────────────────────────
  const far = await get('offset-1000000', `${CONVOS}?limit=${PAGE}&offset=1000000`);
  rec.answers.pastEndBehaviour = {
    status: rec.probes['offset-1000000']?.status,
    count: rows(far).length,
    verdict: rows(far).length === 0 ? 'empty array — clean stop signal' : 'NON-EMPTY — offset is not honoured',
  };

  // ── Q6/Q7: full walk (only if offset actually paginates) ───────────────────
  if (rec.answers.offset.verdict.startsWith('WORKS')) {
    const seen = new Map(); // id -> { index, name, updatedAt, temporary }
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      const body = await get(`walk-page-${page}`, `${CONVOS}?limit=${PAGE}&offset=${page * PAGE}`);
      const batch = rows(body);
      if (batch.length === 0) break;
      for (const c of batch) {
        const id = c.uuid ?? c.id;
        if (!seen.has(id)) {
          seen.set(id, {
            index: seen.size,
            name: c.name ?? '',
            updatedAt: c.updated_at,
            temporary: !!c.is_temporary,
            starred: !!c.is_starred,
          });
        }
      }
      if (batch.length < PAGE) break;
      await sleep(150); // be gentle
    }

    const all = [...seen.values()];
    const marked = (prefix) => all.filter((c) => c.name.startsWith(prefix));
    const waiting = all.filter((c) => c.name.startsWith('🔴') || c.name.startsWith('💤🔴'));

    rec.answers.total = {
      conversations: all.length,
      pagesWalked: page + 1,
      hitPageCap: page >= MAX_PAGES - 1,
      temporary: all.filter((c) => c.temporary).length,
    };
    rec.answers.markers = {
      waiting: waiting.length,
      snoozedWaiting: marked('💤🔴').length,
      resolved: marked('✅').length,
      unmarked: all.length - waiting.length - marked('✅').length,
    };
    // THE number: is anything already outside the 50-item window?
    rec.answers.deepestWaiting = {
      deepestIndex: waiting.length ? Math.max(...waiting.map((c) => c.index)) : null,
      beyond50: waiting.filter((c) => c.index >= 50).length,
      beyond200: waiting.filter((c) => c.index >= 200).length,
      beyond300: waiting.filter((c) => c.index >= 300).length,
      // positions only — no titles, so the pasted JSON carries no chat content
      waitingPositions: waiting.map((c) => c.index).sort((x, y) => x - y),
    };
    // Age of the oldest conversation still listed, to sanity-check churn rate.
    const oldest = all[all.length - 1]?.updatedAt;
    rec.answers.window = {
      newest: all[0]?.updatedAt ?? null,
      at50: all[49]?.updatedAt ?? null,
      at200: all[199]?.updatedAt ?? null,
      oldest: oldest ?? null,
    };
  } else {
    rec.answers.total = 'skipped — offset does not paginate; see probes for alternatives';
  }

  window.copyPaginationRecon = () => {
    copy(JSON.stringify(rec, null, 2)); // DevTools built-in
    console.log('Pagination recon copied to clipboard — paste it to Claude Code.');
  };

  console.log('%cDone. Now run: copyPaginationRecon()', 'font-weight:bold');
  console.log(rec.answers);
})();
