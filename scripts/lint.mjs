// Catches names used but never defined (the kind of slip that only fails when that code path runs), in the server modules
// and in the browser scripts (joined in index.html's order, since they share one global scope). Run: npm run lint
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), ".."), pub = path.join(root, "public");
const order = [...fs.readFileSync(path.join(pub, "index.html"), "utf8").matchAll(/<script src="([a-z0-9_-]+\.js)/gi)].map(m => m[1]);
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ew-lint-")), "browser-bundle.js");
fs.writeFileSync(tmp, order.map(f => `/* ==== ${f} ==== */\n${fs.readFileSync(path.join(pub, f), "utf8")}`).join("\n"));
const eslint = (args) => execFileSync("npx", ["-y", "eslint@8.57.0", "--no-eslintrc", ...args], { cwd: root, stdio: "inherit" });
let failed = false;
try { eslint(["-c", "scripts/eslint.server.json", "--rule", "no-unused-vars: off", "*.mjs"]); } catch { failed = true; }
try { eslint(["-c", "scripts/eslint.browser.json", "--global", "ui,openStockSheet", tmp]); } catch { failed = true; }
try { eslint(["-c", "scripts/eslint.browser.json", "--env", "serviceworker", "public/login.js", "public/sw.js"]); } catch { failed = true; }
console.log(failed ? "lint: problems found" : "lint: no undefined names"); process.exit(failed ? 1 : 0);
