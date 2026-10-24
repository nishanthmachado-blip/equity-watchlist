import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Heart buttons are found with closest("[data-fav]"): a data-fav attribute on <html> would turn every click into a favourite toggle
test("favourites look: page-level setting uses its own attribute (data-favlook), not data-fav", async () => {
  const [html, app, css] = await Promise.all(["public/index.html", "public/app.js", "public/networth.css"].map(f => fs.readFile(new URL(`../${f}`, import.meta.url), "utf8")));
  for (const s of [html, app]) assert.doesNotMatch(s, /setAttribute\("data-fav"/);
  assert.match(html, /data-favlook/); assert.match(app, /FAV_STYLES/);
  assert.doesNotMatch(css, /\[data-fav=/);
  for (const k of ["stripe", "tint", "box"]) assert.match(css, new RegExp(`\\[data-favlook="${k}"\\]`));
});
