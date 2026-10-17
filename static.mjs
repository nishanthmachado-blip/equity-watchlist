// App files (js, css, icons, html): read once, compressed once (brotli + gzip), kept in memory, revalidated by ETag.
// HTML pages link their scripts and styles as file?v=<hash>, so the browser keeps each one for a year and downloads it
// again only when its content changes.
import zlib from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile as readDisk, stat as statDisk } from "node:fs/promises";

// App files (js, css, icons): read once, compressed once, kept in memory. index.html links them as file?v=<hash>, so the
// browser keeps each file for a year and fetches it again only when its content changes (a new hash).
export const staticCache = new Map();
export async function staticAsset(file) {
  const st = await statDisk(file); const c = staticCache.get(file);
  if (c && c.mtime === st.mtimeMs && (!c.deps || (await Promise.all(c.deps.map(d => staticAsset(d).then(x => x.etag)))).join() === c.depTags)) return c;
  let buf = await readDisk(file), deps = null;
  if (file.endsWith(".html")) { const v = await versionLinks(buf.toString("utf8"), path.dirname(file)); buf = Buffer.from(v.html); deps = v.deps; }
  const text = /\.(js|css|html|svg|json|webmanifest)$/.test(file);
  const a = { buf, mtime: st.mtimeMs, etag: `"${createHash("sha1").update(buf).digest("base64url").slice(0, 16)}"`, gz: text ? zlib.gzipSync(buf, { level: 9 }) : null, br: text ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7 } }) : null };
  if (deps) { a.deps = deps; a.depTags = (await Promise.all(deps.map(d => staticAsset(d).then(x => x.etag)))).join(); }
  staticCache.set(file, a); return a;
}
async function versionLinks(html, dir) {
  const refs = [...new Set([...html.matchAll(/(?:src|href)="([a-z0-9_-]+\.(?:js|css))"/gi)].map(m => m[1]))];
  const deps = [];
  for (const r of refs) { try { const f = path.join(dir, r), a = await staticAsset(f); deps.push(f); html = html.split(`"${r}"`).join(`"${r}?v=${a.etag.slice(1, 11)}"`); } catch { /* leave as is */ } }
  return { html, deps };
}
export async function sendStatic(req, res, file, type) {
  const a = await staticAsset(file);
  const immutable = /[?&]v=/.test(req.url) && !file.endsWith(".html");
  const h = { "Content-Type": type, ETag: a.etag, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache", Vary: "Accept-Encoding" };
  if (req.headers["if-none-match"] === a.etag) { res.writeHead(304, h); return res.end(); }
  const ae = String(req.headers["accept-encoding"] || "");
  let body = a.buf;
  if (a.br && /\bbr\b/.test(ae)) { body = a.br; h["Content-Encoding"] = "br"; } else if (a.gz && /gzip/.test(ae)) { body = a.gz; h["Content-Encoding"] = "gzip"; }
  h["Content-Length"] = body.length; res.writeHead(200, h); return res.end(req.method === "HEAD" ? undefined : body);
}
