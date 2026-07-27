/**
 * Walk an offset-paged endpoint until it runs out.
 *
 * Pure and I/O-free: the caller injects `fetchPage`, so this is testable
 * without stubbing `fetch` or `chrome`. Same split as classify/titleTransform/
 * snooze — real logic here, the I/O boundary in the adapter.
 *
 * STOP CONDITIONS, in order:
 *  1. A page shorter than `pageSize`. Confirmed by recon (2026-07-26) to be
 *     the endpoint's clean end-of-list signal: past the end it returns [],
 *     not an error. A page that is exactly full is indistinguishable from
 *     "more to come", so a full final page costs one extra empty request.
 *  2. `maxPages`. A runaway guard, not a feature — if the endpoint ever stops
 *     short-paging, an unguarded loop would hammer it forever. It warns rather
 *     than throwing, so a truncated history degrades to the old narrow-window
 *     behaviour instead of breaking the sweep.
 *
 * @param {(p: {offset: number, limit: number}) => Promise<Array>} fetchPage
 * @param {{pageSize: number, maxPages: number}} opts
 * @returns {Promise<Array>} every item from every page, in order
 */
export async function paginate(fetchPage, { pageSize, maxPages }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage({ offset: page * pageSize, limit: pageSize });
    out.push(...batch);
    if (batch.length < pageSize) return out;
  }
  console.warn(`[bliptracker] page cap hit at ${maxPages} pages — history may be truncated`);
  return out;
}
