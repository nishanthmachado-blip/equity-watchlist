// Mobile check: opens every screen on a range of Android and iOS phone / tablet sizes (as the app would show in a phone
// browser or an in-app web view) on a throw-away account, and fails when a screen
//   - scrolls sideways (the page is wider than the phone), or something sticks out past the right edge
//     (wide tables are fine when they scroll inside their own box),
//   - throws a script error,
//   - has a text box with text smaller than 16px (iOS zooms the whole page in when you tap it),
//   - has a button or link smaller than 24 × 24 px (hard to tap; WCAG 2.5.8),
//   - opens a dialog that doesn't fit on the screen.
// Also checks the page's viewport tag and the bottom bar's safe-area padding (iPhone home indicator).
//   npm run mobile                        all devices, all screens
//   npm run mobile -- --device "iPhone SE" --view networth
//   npm run mobile -- --shots out/        also save a screenshot of every screen (for a look by eye)
//   npm run mobile -- --webkit            iOS sizes on WebKit too (when Playwright's WebKit is installed)
import { createRequire } from "node:module";
// Playwright is only needed for this check: npm i -D playwright && npx playwright install chromium (once)
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { console.log("mobile check skipped: Playwright is not installed (npm i -D playwright && npx playwright install chromium)"); process.exit(0); }
const { chromium, webkit, devices } = pw;
import fs from "node:fs/promises";
import path from "node:path";
import { startTestServer } from "./testserver.mjs";

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pick = (name, label = name) => { const d = { ...devices[name] }; delete d.defaultBrowserType; return { label, os: /iPhone|iPad/.test(name) ? "ios" : "android", ...d }; };
// the smallest and the most common screens on both systems, a foldable, a tablet and a phone on its side
export const DEVICES = [
  pick("Galaxy Z Fold 6 Cover", "Galaxy Fold cover (narrowest)"), pick("Galaxy S8", "Galaxy S8 / small Android (360)"), pick("Moto G4", "Moto G4 / budget Android (360)"),
  pick("Pixel 7", "Pixel 7 (412)"), pick("Galaxy S24", "Galaxy S24"), pick("iPhone SE", "iPhone SE 1st gen (320)"), pick("iPhone SE (3rd gen)", "iPhone SE 3rd gen (375)"), pick("iPhone 13", "iPhone 13 / 14 (390)"), pick("iPhone 15 Pro Max", "iPhone 15 Pro Max (430)"),
  pick("iPad Mini", "iPad Mini (768)"), pick("Galaxy Tab S9", "Galaxy Tab S9"), pick("iPhone 13 landscape", "iPhone 13 landscape"), pick("Pixel 7 landscape", "Pixel 7 landscape")
];
// every screen in the side menu (setView names) and the tabs inside some of them
export const VIEWS = ["home", "watchlist", "portfolio", "swing", "swingbook", "networth", "buckets", "fire", "expenses", "tax", "dividends", "muhurat", "mf", "us", "returns", "events",
  "accumulate", "alerts", "integrations", "market", "indices", "lists", "favs", "orders", "review", "longterm", "fundreview", "decide", "opportunity", "model", "focus", "invest", "reports",
  "valuation", "plan", "picks", "growth", "thesis", "funds"];
const TABS = { dividends: ['[data-dvtab="received"]'] };

// runs in the page: what's wrong on the screen as shown
function audit({ os }) {
  const W = innerWidth, out = { overflow: null, sticking: [], smallInputs: [], smallTargets: [] };
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const name = el => { let s = el.tagName.toLowerCase(); if (el.id) s += `#${el.id}`; else if (el.classList.length) s += `.${[...el.classList].slice(0, 2).join(".")}`; const p = el.closest("[id]"); return p && p !== el ? `${s} in #${p.id}` : s; };
  // a box that scrolls sideways, or cuts off what's inside: whatever is inside may be wider than the screen
  const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; if (s.position === "fixed") return false; } return false; };
  const sw = document.documentElement.scrollWidth; if (sw > W + 1) out.overflow = sw;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("[hidden],template,svg,.toast-wrap,#toasts")) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.right <= W + 2 || r.left >= W) continue;
    if (!visible(el) || clipped(el)) continue;
    if (getComputedStyle(el).position === "fixed" && r.left >= W - 2) continue; // off-canvas drawer
    out.sticking.push(`${name(el)} (${Math.round(r.right - W)}px past the edge)`);
    if (out.sticking.length > 6) break;
  }
  for (const el of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]),select,textarea")) {
    if (!visible(el) || el.closest("[hidden]")) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize); if (os === "ios" && fs < 15.5) out.smallInputs.push(`${name(el)} ${fs}px`);
  }
  for (const el of document.querySelectorAll("button,a[href],[role=button],select,input[type=checkbox],input[type=radio],summary")) {
    if (!visible(el) || el.closest("[hidden]") || el.closest("table") && el.tagName === "A") continue;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight * 6) continue;
    // a link inside a sentence is fine (WCAG inline exception)
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 10) continue;
    if (el.classList.contains("linklike") && getComputedStyle(el).display.startsWith("inline")) continue;
    if (r.width < 24 || r.height < 24) out.smallTargets.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  out.smallInputs = [...new Set(out.smallInputs)].slice(0, 6); out.smallTargets = [...new Set(out.smallTargets)];
  return out;
}

async function main() {
  const onlyDev = arg("--device"), onlyView = arg("--view"), shots = arg("--shots"), useWebkit = args.includes("--webkit");
  const devs = DEVICES.filter(d => !onlyDev || d.label.toLowerCase().includes(onlyDev.toLowerCase()));
  const views = VIEWS.filter(v => !onlyView || v === onlyView);
  if (shots) await fs.mkdir(shots, { recursive: true });
  const srv = await startTestServer({ prefix: "ew-mobile-" });
  const problems = [], warnings = [];
  const engines = [["chromium", chromium]]; if (useWebkit) engines.push(["webkit", webkit]);
  try {
    // the page's own set-up for phones
    const html = await (await fetch(srv.base + "/", { headers: { Cookie: srv.cookie } })).text();
    const vp = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] || "";
    if (!/width=device-width/.test(vp)) problems.push("viewport tag: width=device-width missing");
    if (!/viewport-fit=cover/.test(vp)) problems.push("viewport tag: viewport-fit=cover missing (iPhone notch / home bar)");
    if (/user-scalable=no|maximum-scale=1(?!\d)/.test(vp)) problems.push("viewport tag blocks pinch-zoom (accessibility)");
    for (const [eng, type] of engines) {
      let browser; try { browser = await type.launch(); } catch (e) { warnings.push(`${eng}: not installed here, skipped (${e.message.split("\n")[0].slice(0, 80)})`); continue; }
      // a few devices at a time (each in its own browser context)
      const queue = devs.filter(d => eng !== "webkit" || d.os === "ios"), results = new Map();
      const one = async d => {
        const { label, os, ...ctxOpts } = d;
        const ctx = await browser.newContext(ctxOpts); const u = new URL(srv.base);
        await ctx.addCookies([{ name: srv.cookie.split("=")[0], value: srv.cookie.split("=").slice(1).join("="), domain: u.hostname, path: "/" }]);
        const page = await ctx.newPage(); const errors = [];
        page.on("pageerror", e => errors.push(e.message.split("\n")[0]));
        await page.goto(srv.base + "/", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
        // the bottom bar must keep clear of the iPhone home indicator
        const bar = await page.evaluate(() => { const b = document.querySelector(".tabbar"); if (!b || !b.getBoundingClientRect().height) return null; const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } }).join(" "); return { found: true, safe: /safe-area-inset-bottom/.test(css) }; });
        if (bar && !bar.safe) problems.push(`${label}: bottom bar has no safe-area padding`);
        for (const v of views) {
          errors.length = 0;
          await page.evaluate(view => window.setView?.(view), v); await page.waitForTimeout(v === "home" ? 1200 : 900);
          for (const t of TABS[v] || []) { const el = await page.$(t); if (el && await el.isVisible()) { await el.click().catch(() => {}); await page.waitForTimeout(700); } }
          const r = await page.evaluate(audit, { os });
          const where = `${eng === "webkit" ? "[WebKit] " : ""}${label} · ${v}`;
          if (r.overflow) problems.push(`${where}: page scrolls sideways (${r.overflow}px wide on a ${ctxOpts.viewport.width}px screen)`);
          if (r.sticking.length) problems.push(`${where}: sticks out past the right edge: ${r.sticking.join("; ")}`);
          if (r.smallInputs.length) problems.push(`${where}: text boxes under 16px (iOS zooms in on tap): ${r.smallInputs.join("; ")}`);
          if (r.smallTargets.length) problems.push(`${where}: ${r.smallTargets.length} tap target${r.smallTargets.length === 1 ? "" : "s"} under 24px: ${r.smallTargets.slice(0, 5).join("; ")}${r.smallTargets.length > 5 ? " …" : ""}`);
          if (errors.length) problems.push(`${where}: script error: ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
          if (shots) await page.screenshot({ path: path.join(shots, `${label.replace(/[^a-z0-9]+/gi, "-")}-${v}.png`), fullPage: false });
        }
        // a dialog must fit the screen and its buttons must be reachable
        await page.evaluate(() => { window.setView?.("networth"); window.ui?.dialog({ title: "Check", bodyHtml: '<label class="ui-field"><span>Name</span><input class="ui-input" name="x"></label>'.repeat(8), okText: "OK" }); });
        await page.waitForTimeout(500);
        const dlg = await page.evaluate(() => { const d = document.querySelector(".ui-dlg"); if (!d) return null; const r = d.getBoundingClientRect(), ok = d.querySelector("[data-ui=ok]"); d.scrollTop = d.scrollHeight; const o = ok?.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, w: innerWidth, h: innerHeight, okIn: !!o && o.bottom <= innerHeight + 1 && o.top >= 0 }; });
        if (dlg && (dlg.left < -1 || dlg.right > dlg.w + 1 || dlg.top < -1)) problems.push(`${label}: dialog doesn't fit the screen (${Math.round(dlg.left)}–${Math.round(dlg.right)} of ${dlg.w}px)`);
        if (dlg && !dlg.okIn) problems.push(`${label}: dialog's OK button can't be reached`);
        await ctx.close();
        process.stdout.write(`✓ ${eng === "webkit" ? "[WebKit] " : ""}${label}\n`);
      };
      const workers = Array.from({ length: Number(arg("--parallel", 4)) }, async () => { while (queue.length) await one(queue.shift()); });
      await Promise.all(workers); void results;
      await browser.close();
    }
  } finally { await srv.stop(); }
  for (const w of warnings) console.log(`note: ${w}`);
  if (problems.length) { console.log(`\nmobile: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n - ${problems.join("\n - ")}`); process.exit(1); }
  console.log(`\nmobile: ${devs.length} devices × ${views.length} screens, no problems`);
}
main().catch(e => { console.error(e); process.exit(1); });
