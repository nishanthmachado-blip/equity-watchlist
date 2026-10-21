import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Reads that overlap writes must see either the old or the new file, never an empty / cut-off one (that used to make
// "the watchlist is empty", and the next save wrote it back: 75 stocks became 1).
test("storage: file writes are atomic; concurrent reads always parse", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aw-"));
  const S = await import(`../storage.mjs?aw${Date.now()}`);
  await S.initStorage({ dataDir: dir, logger: () => {} });
  const file = path.join(dir, "users", "abc", "watchlist.json"); await fs.mkdir(path.dirname(file), { recursive: true });
  const big = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, company: `Company ${i} `.repeat(20), ticker: `T${i}` })));
  await S.dfs.writeFile(file, big(500));
  let bad = 0, reads = 0; const stop = Date.now() + 700;
  const writer = (async () => { let k = 0; while (Date.now() < stop) await S.dfs.writeFile(file, big(400 + (k++ % 200))); })();
  const readers = Array.from({ length: 4 }, async () => { while (Date.now() < stop) { const t = await S.dfs.readFile(file, "utf8"); reads++; try { if (!JSON.parse(t).length) bad++; } catch { bad++; } } });
  await Promise.all([writer, ...readers]);
  assert.ok(reads > 50, `reads: ${reads}`); assert.equal(bad, 0);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(f => f.endsWith(".tmp")), [], "no temporary files left behind");
});
