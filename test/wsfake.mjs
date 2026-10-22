// A tiny WebSocket server for tests (no dependencies): handshake, text / binary frames out, masked frames in.
import crypto from "node:crypto";

export function attachWs(server, { path = "/smart-stream", onConnect } = {}) {
  server.on("upgrade", (req, sock) => {
    if (!req.url.startsWith(path)) { sock.destroy(); return; }
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    const conn = { headers: req.headers, closed: false, received: [],
      send(data) { if (conn.closed) return; const bin = Buffer.isBuffer(data), p = bin ? data : Buffer.from(String(data)); const h = p.length < 126 ? Buffer.from([bin ? 0x82 : 0x81, p.length]) : Buffer.from([bin ? 0x82 : 0x81, 126, p.length >> 8, p.length & 255]); sock.write(Buffer.concat([h, p])); },
      close() { if (conn.closed) return; conn.closed = true; try { sock.write(Buffer.from([0x88, 0])); sock.end(); } catch { /* gone */ } },
      onMessage: null };
    if (onConnect && onConnect(conn, req) === false) { sock.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); sock.destroy(); return; }
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    sock.on("data", d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, masked = buf[1] & 128; let len = buf[1] & 127, o = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
        const need = o + (masked ? 4 : 0) + len; if (buf.length < need) return;
        const mask = masked ? buf.subarray(o, o + 4) : null, p = Buffer.from(buf.subarray(o + (masked ? 4 : 0), need)); if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
        buf = buf.subarray(need);
        if (op === 8) { conn.close(); return; }
        if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, p.length]), p])); continue; }
        const msg = op === 1 ? p.toString("utf8") : p; conn.received.push(msg); conn.onMessage?.(msg);
      }
    });
    sock.on("close", () => { conn.closed = true; }); sock.on("error", () => { conn.closed = true; });
  });
}
