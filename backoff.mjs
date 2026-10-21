// Escalating pause for a price / data site that refuses us: 10 → 20 → 40 → 60 minutes on blocks in a row, cleared by
// the first success. Asking again while a site is blocking us only extends the ban, so callers skip a paused site.
export function createBackoff({ baseMs = 10 * 60e3, maxMs = 60 * 60e3 } = {}) {
  let until = 0, streak = 0, last = null;
  return {
    until(now = Date.now()) { return until > now ? until : 0; },
    block(why = null, now = Date.now(), hintMs = null) { streak++; last = why; const ms = Math.min(maxMs, hintMs > 0 ? hintMs : baseMs * 2 ** (streak - 1)); /* the site's own Retry-After wins */ until = now + ms; return until; },
    ok() { streak = 0; until = 0; },
    reset() { until = 0; }, // a manual retry: the streak is kept, so a repeat block pauses longer
    get streak() { return streak; }, get last() { return last; }
  };
}
export const isNetRefusal = e => /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|socket hang up|other side closed/i.test(`${e?.cause?.code || ""} ${e?.cause?.message || ""} ${e?.message || ""} ${(e?.cause?.errors || []).map(x => x?.code).join(" ")}`);
