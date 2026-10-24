import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = f => fs.readFile(new URL(`../${f}`, import.meta.url), "utf8");
test("themes: Clean / Clean night exist everywhere they must (menu list, early head script, styles)", async () => {
  const [html, app, css] = await Promise.all(["public/index.html", "public/app.js", "public/redesigns.css"].map(read));
  for (const id of ["clean", "clean-night", "saffron", "onyx", "chilli", "sage", "regal", "mono", "breeze", "breeze-night"]) {
    assert.match(app, new RegExp(`id:"${id}",group:"redesign"`));
    assert.match(html, new RegExp(`"${id}":\\[`), "head script knows the theme (no flash of the default look)");
    assert.match(css, new RegExp(`\\[data-skin="${id}"\\]`));
  }
});
test("layout: menu side, menu labels and density are offered and styled", async () => {
  const [html, app, css] = await Promise.all(["public/index.html", "public/app.js", "public/redesigns.css"].map(read));
  for (const k of ["menuside", "menu", "density"]) assert.match(app, new RegExp(`\\["${k}",`));
  assert.match(html, /data-menuside/); assert.match(html, /data-density/);
  assert.match(css, /\[data-menuside="left"\] \.side-menu/); assert.match(css, /\[data-density="compact"\] td/);
});
test("logo column keeps room for the badge in Compact density (rule loaded after the density rules)", async () => {
  const css = await read("public/redesigns.css");
  const compact = css.indexOf('[data-density="compact"] td{'), fix = css.indexOf('html[data-density="compact"] main td.co-has-logo{padding-left:42px!important}');
  assert.ok(compact > 0 && fix > compact, "the logo-cell padding comes after (and is more specific than) the compact cell padding");
});
test("folded menu: opens on hover or keyboard focus only, not because a clicked item keeps focus", async () => {
  const [shell, home] = await Promise.all(["public/shell.css", "public/home.js"].map(read));
  assert.doesNotMatch(shell, /side-menu:focus-within/); assert.match(shell, /side-menu:has\(:focus-visible\)/);
  assert.match(home, /pointerleave", fold/);
});
