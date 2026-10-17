// Automatic daily backups: one gzip file per account per day in BACKUP_DIR (kept 30 days), optionally copied to S3
// (BACKUP_S3_BUCKET; credentials from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the EC2 instance role). Every file is
// read back and checked after it is written. S3 upload is a plain signed PUT (AWS Signature V4), so no AWS SDK is needed.
import zlib from "node:zlib";
import { createHash, createHmac } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

export const backupConfig = () => ({
  dir: process.env.BACKUP_DIR || null, keepDays: Math.max(3, Number(process.env.BACKUP_KEEP_DAYS) || 30),
  s3: process.env.BACKUP_S3_BUCKET ? { bucket: process.env.BACKUP_S3_BUCKET, region: process.env.BACKUP_S3_REGION || process.env.AWS_REGION || "ap-south-1", prefix: (process.env.BACKUP_S3_PREFIX || "equity-watchlist/").replace(/^\/+/, "") } : null,
  includeSecrets: process.env.BACKUP_INCLUDE_SECRETS === "1"
});
export const gz = obj => zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
export const gunz = buf => JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
// Checks that a backup file opens and holds what was written
export function verifyBackup(buf, expectFiles) {
  const b = gunz(buf);
  if (b?.app !== "equity-watchlist" || b.kind !== "account-backup" || typeof b.files !== "object") throw new Error("not an account backup");
  const n = Object.keys(b.files).length; if (n !== expectFiles) throw new Error(`holds ${n} files, expected ${expectFiles}`);
  return { files: n, account: b.account, createdAt: b.createdAt };
}
export async function writeLocal(dir, day, name, buf) {
  const d = path.join(dir, day); await fsp.mkdir(d, { recursive: true, mode: 0o700 });
  const f = path.join(d, `${name}.json.gz`); await fsp.writeFile(f, buf, { mode: 0o600 }); return f;
}
export async function listLocal(dir, name) {
  const days = (await fsp.readdir(dir).catch(() => [])).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(), out = [];
  for (const d of days) { try { const st = await fsp.stat(path.join(dir, d, `${name}.json.gz`)); out.push({ day: d, bytes: st.size }); } catch { /* not for this account */ } }
  return out;
}
export const readLocal = (dir, day, name) => fsp.readFile(path.join(dir, day, `${name}.json.gz`));
export async function pruneLocal(dir, keepDays, today) {
  const cut = new Date(Date.parse(`${today}T00:00:00Z`) - keepDays * 864e5).toISOString().slice(0, 10); let n = 0;
  for (const d of await fsp.readdir(dir).catch(() => [])) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cut) { await fsp.rm(path.join(dir, d), { recursive: true, force: true }); n++; }
  return n;
}
// ---- S3 (Signature V4) ----
const sha = b => createHash("sha256").update(b).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
let roleCreds = null;
async function credentials(fetchImpl) {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY, token: process.env.AWS_SESSION_TOKEN || null };
  if (roleCreds && roleCreds.exp - Date.now() > 5 * 60e3) return roleCreds;
  // EC2 instance role through IMDSv2
  const base = "http://169.254.169.254/latest", tok = await (await fetchImpl(`${base}/api/token`, { method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" }, signal: AbortSignal.timeout(2000) })).text();
  const h = { "X-aws-ec2-metadata-token": tok }, role = (await (await fetchImpl(`${base}/meta-data/iam/security-credentials/`, { headers: h, signal: AbortSignal.timeout(2000) })).text()).split("\n")[0].trim();
  if (!role) throw new Error("no AWS credentials (set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or give the instance a role)");
  const c = await (await fetchImpl(`${base}/meta-data/iam/security-credentials/${role}`, { headers: h, signal: AbortSignal.timeout(2000) })).json();
  roleCreds = { id: c.AccessKeyId, secret: c.SecretAccessKey, token: c.Token, exp: Date.parse(c.Expiration) }; return roleCreds;
}
export function signS3({ method, host, key, region, body, creds, now = new Date() }) {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), date = amz.slice(0, 8), hash = sha(body || "");
  const uri = "/" + key.split("/").map(encodeURIComponent).join("/");
  const headers = { host, "x-amz-content-sha256": hash, "x-amz-date": amz, ...(creds.token ? { "x-amz-security-token": creds.token } : {}) };
  const names = Object.keys(headers).sort(), canon = [method, uri, "", names.map(n => `${n}:${headers[n]}`).join("\n") + "\n", names.join(";"), hash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`, toSign = ["AWS4-HMAC-SHA256", amz, scope, sha(canon)].join("\n");
  const kSign = hmac(hmac(hmac(hmac(`AWS4${creds.secret}`, date), region), "s3"), "aws4_request");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(";")}, Signature=${createHmac("sha256", kSign).update(toSign).digest("hex")}`;
  delete headers.host; return { url: `https://${host}${uri}`, headers };
}
export async function s3Put(cfg, key, body, { fetchImpl = fetch } = {}) {
  const creds = await credentials(fetchImpl), host = process.env.BACKUP_S3_ENDPOINT || `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const { url, headers } = signS3({ method: "PUT", host, key: cfg.prefix + key, region: cfg.region, body, creds });
  const r = await fetchImpl(url, { method: "PUT", headers: { ...headers, "content-type": "application/gzip" }, body, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`S3 HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  return cfg.prefix + key;
}
