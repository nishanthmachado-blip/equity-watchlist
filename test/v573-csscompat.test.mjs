import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cssCompat, mixFallback } from "../static.mjs";

test("older web views: color-mix, dvh and backdrop-filter get a plain fallback first", () => {
  assert.equal(mixFallback("color-mix(in srgb,var(--ix) 18%,transparent)"), "transparent");
  assert.equal(mixFallback("color-mix(in srgb,var(--good) 70%,#fff)"), "var(--good)");
  assert.equal(mixFallback("1px solid color-mix(in srgb,var(--a),#fff 30%)"), "1px solid var(--a)");
  const out = cssCompat(".a{border-color:color-mix(in srgb,var(--ix) 60%,transparent)!important}.c{max-height:calc(100dvh - 36px)}.d{backdrop-filter:blur(8px)}");
  assert.match(out, /\.a\{border-color:var\(--ix\)!important;border-color:color-mix/);
  assert.match(out, /max-height:calc\(100vh - 36px\);max-height:calc\(100dvh - 36px\)/);
  assert.match(out, /-webkit-backdrop-filter:blur\(8px\);backdrop-filter:blur\(8px\)/);
});

test("every stylesheet still parses the same way: same rules, no colour lost", () => {
  for (const f of fs.readdirSync(new URL("../public/", import.meta.url)).filter(f => f.endsWith(".css"))) {
    const a = fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8"), b = cssCompat(a);
    assert.equal((b.match(/\{/g) || []).length, (a.match(/\{/g) || []).length, f);
    assert.equal((b.match(/color-mix\(/g) || []).length, (a.match(/color-mix\(/g) || []).length, f);
    assert.ok(!/:\s*;/.test(b.replace(/:\s*;/g, (m, i) => (/:\s*;/.test(a) ? "" : m))), f);
  }
});

test("index.html: viewport for phones and notches, pinch-zoom allowed, helpers for older web views", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const vp = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.match(vp, /width=device-width/); assert.match(vp, /viewport-fit=cover/); assert.doesNotMatch(vp, /user-scalable=no/);
  assert.match(html, /Array\.prototype,'at'/); assert.match(html, /Object,'hasOwn'/);
});
