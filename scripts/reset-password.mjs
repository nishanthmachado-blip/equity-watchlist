// Server-side account recovery, for when you can't sign in (forgot the username or password, lost the phone with your
// authenticator app). Needs access to the server itself, so only whoever runs the app can use it.
//
//   List the accounts:              node scripts/reset-password.mjs
//   New temporary password:         node scripts/reset-password.mjs <username>
//   …and switch off two-step too:   node scripts/reset-password.mjs <username> --reset-2fa
//
// Docker (MongoDB): stop the app first so it doesn't overwrite the change, then start it again:
//   docker compose stop app
//   docker compose run --rm app node scripts/reset-password.mjs                 (lists the accounts)
//   docker compose run --rm app node scripts/reset-password.mjs <username> --reset-2fa
//   docker compose start app
// Plain Node: stop the service, run it with the same DATA_DIR / MONGO_URL / .env as the app, start the service.
// The account is signed out everywhere; restarting also clears any "too many wrong attempts" lock-out.
import "../env.mjs"; // the app's .env (MONGO_URL, DATA_DIR, SECRETS_KEY…)
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "../auth.mjs";
import { initStorage, closeStorage } from "../storage.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const args = process.argv.slice(2), name = String(args.find(a => !a.startsWith("--")) || "").trim().toLowerCase(), reset2fa = args.includes("--reset-2fa");
await initStorage({ dataDir, importFiles: false, logger: () => {} });
const auth = createAuth({ dir: path.join(dataDir, "auth"), log: () => {} });
const all = auth.allUsers();
const when = t => (t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");
const listing = () => all.map(u => `  @${u.username}${u.role === "owner" ? "  (owner)" : ""}${u.disabled ? "  [disabled]" : ""}${u.twoStep ? "  [two-step on]" : ""}  — ${u.name}, last sign-in ${when(u.lastLoginAt)}`).join("\n") || "  (no accounts yet: open the app and create the owner with the setup code)";

if (!name) {
  console.log(`Accounts in ${process.env.MONGO_URL ? "the MongoDB database" : dataDir}:\n${listing()}\n\nReset one:  node scripts/reset-password.mjs <username> [--reset-2fa]`);
  await closeStorage(); process.exit(0);
}
const u = all.find(x => x.username === name);
if (!u) { console.error(`No account "${name}". Accounts:\n${listing()}`); await closeStorage(); process.exit(1); }
const pw = crypto.randomBytes(12).toString("base64url");
await auth.resetPassword(u.id, pw);
if (reset2fa) await auth.mfaReset(u.id, "the server (reset script)");
await closeStorage();
console.log(`New temporary password for @${u.username}: ${pw}${reset2fa ? "\nTwo-step sign-in is switched off for this account (turn it on again from 👤 → Two-step sign-in)." : u.twoStep ? "\nTwo-step sign-in is still on: you'll need the code from your authenticator app or a recovery code (add --reset-2fa if you lost them)." : ""}
Now start / restart the app, sign in, and change the password from 👤 → Change password.`);
