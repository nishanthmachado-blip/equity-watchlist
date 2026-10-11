// Server-side password reset (e.g. the owner forgot theirs). Run on the host as the app user:
//   DATA_DIR=/var/lib/equity-watchlist node scripts/reset-password.mjs <username>
// With Docker (MongoDB): stop the app first, then
//   docker compose stop app && docker compose run --rm app node scripts/reset-password.mjs <username> && docker compose start app
// Prints a new temporary password and signs that account out everywhere.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "../auth.mjs";
import { initStorage, closeStorage } from "../storage.mjs";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
await initStorage({ dataDir, importFiles: false, logger: () => {} });
const dir = path.join(dataDir, "auth");
const name = String(process.argv[2] || "").toLowerCase();
const auth = createAuth({ dir });
const u = auth.allUsers().find(x => x.username === name);
if (!u) { console.error(`No account "${name}". Accounts: ${auth.allUsers().map(x => x.username).join(", ") || "(none)"}`); process.exit(1); }
const pw = crypto.randomBytes(12).toString("base64url");
await auth.resetPassword(u.id, pw);
await closeStorage();
console.log(`New temporary password for @${u.username}: ${pw}\nStart / restart the app, sign in, then change it from 👤 → Change password.`);
