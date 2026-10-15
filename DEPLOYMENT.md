# Equity Watchlist v4.8.1: Deployment Guide (AWS)

**Audience:** deployment / infrastructure team
**App version:** 4.8.1
**Owner:** Nishanth

---

> **v4.0 recommended path: Docker + MongoDB.** See **DOCKER.md**. On an EC2 / Lightsail box:
>
> ```
> cp .env.example .env    # set MONGO_PASSWORD, SETUP_CODE, DOMAIN, SEC_USER_AGENT
> docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
> ```
>
> All data is then in the `mongo-data` Docker volume (or MongoDB Atlas via `MONGO_URL`), so redeploys never reset it. The sections below describe the plain Node.js + systemd setup, which still works and also accepts `MONGO_URL`.

## 1. Summary

Equity Watchlist is a small Node.js web app for valuing Indian stocks and tracking broker holdings (Zerodha Kite, Angel One, Dhan, Groww, INDmoney). It has no external dependencies: no `npm install`, no database. All state is JSON files on local disk.

From v2.8, **every page and API needs a sign-in**, and each account's data is kept in its own folder. One person's holdings, watchlists and broker logins are never visible to another account.

**The one hard rule:** the app must only be reachable over **HTTPS**. Passwords and session cookies must never cross the internet in plain HTTP.

---

## 2. Requirements

| Item | Requirement |
|---|---|
| Runtime | Node.js **20 LTS or newer** (tested on 22.x) |
| Packages | None (`npm install` is not needed) |
| Instance | EC2 `t3.small` / `t4g.small` or a Lightsail 2 GB box is plenty |
| OS | Any Linux (Amazon Linux 2023 / Ubuntu 22.04+) |
| Disk | Under 1 GB of data; use an EBS volume if you want it separate from the root disk |
| Outbound internet | HTTPS (443) to: `www.screener.in`, `query1/query2.finance.yahoo.com`, `fc.yahoo.com`, `www.google.com`, `news.google.com`, `www.nseindia.com`, `mcp.kite.trade`, `api.kite.trade` (company list for search, with Kite instrument numbers), `query2.finance.yahoo.com` (Yahoo fallback host), `nsearchives.nseindia.com`, `apiconnect.angelone.in`, `api.dhan.co`, `auth.dhan.co`, `api.groww.in`, `api.indstocks.com`, `mcp.indmoney.com` (INDmoney MCP), `www.sec.gov`, `data.sec.gov`, `stooq.com` (US stocks tab), `api.anthropic.com` (only if the AI advisor is used), `api.telegram.org` (phone alerts, if a user connects a Telegram bot) |
| Inbound | 443 (and 80 for certificate issuance) from the internet; SSH from admin IPs only |
| Domain | A DNS name, e.g. `watchlist.example.com` |

---

## 3. Architecture

```
Internet ──HTTPS 443──► Caddy (TLS, auto certificate) ──HTTP──► Node app on 127.0.0.1:4173
                         or AWS ALB + ACM certificate                     │
                                                                          ▼
                                                              DATA_DIR (default ./data)
                                                              ├── auth/        accounts + sessions (mode 600)
                                                              ├── users/<id>/  one private folder per account
                                                              └── *.json       shared public market-data caches
```

- The app listens on **127.0.0.1:4173** by default, so it cannot be reached directly from outside.
- TLS is handled by a reverse proxy in front (Caddy recommended; an ALB also works).

---

## 4. Option A (recommended): a single EC2 instance with Caddy

### 4.1 Install

```bash
# Node 22 (Amazon Linux 2023 example; use NodeSource or nvm on Ubuntu)
sudo dnf install -y nodejs22   # or: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs

# App user and folders
sudo useradd --system --create-home --home-dir /opt/equity-watchlist --shell /sbin/nologin equity
sudo mkdir -p /var/lib/equity-watchlist && sudo chown equity:equity /var/lib/equity-watchlist && sudo chmod 700 /var/lib/equity-watchlist

# Code (unzip the release here)
sudo unzip equity-watchlist-v2.8.zip -d /opt/
sudo chown -R equity:equity /opt/equity-watchlist
```

### 4.2 Move the existing data (only when migrating the owner's local install)

Copy the owner's existing `data/` folder contents into `/var/lib/equity-watchlist/`. On first setup the app moves those files into the owner's private folder automatically.

```bash
sudo cp -r ./data/. /var/lib/equity-watchlist/ && sudo chown -R equity:equity /var/lib/equity-watchlist
```

### 4.3 Environment file: `/etc/equity-watchlist.env` (mode 600, owned by root)

```ini
PORT=4173
HOST=127.0.0.1
PUBLIC_URL=https://watchlist.example.com
TRUST_PROXY=1
COOKIE_SECURE=1
DATA_DIR=/var/lib/equity-watchlist
SESSION_DAYS=30
# Optional:
SEC_USER_AGENT="Nishanth your-email@example.com"   # required by SEC for the US stocks tab
# ANTHROPIC_API_KEY=...        # AI advisor (owner only unless ALLOW_MEMBER_ADVISOR=1)
# ANGEL_API_KEY=...            # Owner's broker keys; other accounts enter their own in the app
```

```bash
sudo chmod 600 /etc/equity-watchlist.env
```

### 4.4 systemd service: `/etc/systemd/system/equity-watchlist.service`

```ini
[Unit]
Description=Equity Watchlist
After=network-online.target
Wants=network-online.target

[Service]
User=equity
Group=equity
WorkingDirectory=/opt/equity-watchlist
EnvironmentFile=/etc/equity-watchlist.env
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/equity-watchlist
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now equity-watchlist
sudo journalctl -u equity-watchlist -n 30 --no-pager
```

### 4.5 Caddy: `/etc/caddy/Caddyfile`

```caddyfile
watchlist.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:4173
}
```

```bash
sudo systemctl enable --now caddy && sudo systemctl reload caddy
```

Caddy gets and renews the Let's Encrypt certificate by itself. It needs ports 80 and 443 open, and DNS must already point at the instance.

### 4.6 Security group

| Direction | Port | Source | Why |
|---|---|---|---|
| Inbound | 443 | 0.0.0.0/0 (or a restricted CIDR list) | App over HTTPS |
| Inbound | 80 | 0.0.0.0/0 | Certificate issuance; Caddy redirects to HTTPS |
| Inbound | 22 | Admin IPs only (or use SSM Session Manager and close 22) | Administration |
| Inbound | 4173 | **Nobody** | The app port must never be public |
| Outbound | 443 | 0.0.0.0/0 | Market data and broker APIs |

---

## 5. Option B: an Application Load Balancer with an ACM certificate

Use this option if the team standardises on ALBs.

1. Get an ACM certificate for the domain and create an ALB with an **HTTPS :443** listener. Add an HTTP :80 listener that redirects to 443.
2. Set the target group to **HTTP :4173**, pointing at the instance.
3. Set the health check path to **`/healthz`**. It is public, returns `{"ok":true}` and reveals nothing.
4. App environment: same as section 4.3, but with **`HOST=0.0.0.0`**.
5. Security groups:
   - **Instance SG:** allow 4173 **only from the ALB's security group**, nothing else.
   - **ALB SG:** allow 443 and 80 from the internet.
6. Keep `TRUST_PROXY=1` so the app reads `X-Forwarded-Proto` / `X-Forwarded-For` from the ALB. This affects secure cookies and the per-IP login rate limiting.

> Run a **single instance only**. Sessions and data are local files, so do not put several instances behind the ALB unless they share the same `DATA_DIR`. One instance is enough for this workload.

---

## 6. First run: create the owner account

1. Start the service and read the log:
   ```bash
   sudo journalctl -u equity-watchlist -n 30 --no-pager
   ```
   It prints a one-time **setup code**, also saved in `$DATA_DIR/auth/setup-code.txt`:
   ```
   [auth] No owner account yet. Open the app and create it with this one-time setup code:
       Xy3kQ9...
   ```
2. Send the code to the owner (Nishanth) over a private channel. The owner opens `https://watchlist.example.com`, enters the code and creates the owner account.
3. The code is deleted once used. Any pre-existing data in `DATA_DIR` moves into the owner's private folder.

**Do this right after the first start.** Until the owner account exists, anyone holding the setup code could claim the app. Alternatively, set `SETUP_CODE=<value>` in the env file to fix the code in advance, then remove it after setup.

---

## 7. Accounts and data privacy (for reference)

- **No public sign-up.** Only the owner creates accounts (👤 → Manage accounts). From there the owner can also reset a password, disable an account, or remove one; removing deletes that account's data folder.
- **Private per account** (stored in `users/<id>/`):
  - watchlists and lists
  - synced broker holdings
  - Kite / Angel One / Dhan / Groww / INDmoney sessions and saved API keys
  - alerts, theses, buying plan, dividend plan, fund X-rays, valuation log
- **Shared** (top level of `DATA_DIR`): public market-data caches only (fundamentals, Screener extras, dividend history, technicals, fund name→symbol map). These hold no personal data.
- **Owner only:**
  - broker keys in the env file (other accounts enter their own in the app)
  - manual fundamentals import
  - the AI advisor (unless `ALLOW_MEMBER_ADVISOR=1`)

### Security controls built into the app

| Control | Implementation |
|---|---|
| Password storage | scrypt (N=16384, r=8, p=1) with a per-user random salt |
| Sessions | 256-bit random token in an `HttpOnly; SameSite=Lax` cookie, plus `Secure` on HTTPS. Only a SHA-256 of the token is stored on disk. 30-day expiry. |
| Brute force | 5 wrong passwords lock that username for 15 minutes; 20 failures per IP within the same 15-minute window |
| Password change | Signs out every other session |
| CSRF | Writes are refused if `Origin` is not the app's own host, or if `Sec-Fetch-Site: cross-site` |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, HSTS on HTTPS |
| Request size | Bodies capped at 30 MB |
| File permissions | Auth and broker session files are written with mode 600 |
| Isolation | Every request runs in its user's context; a request without a user fails rather than falling back to shared files |

---

## 8. Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Listen port |
| `HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` only behind an ALB with a locked-down SG. |
| `PUBLIC_URL` | `http://localhost:4173` | Public https URL; used for the Angel One / Dhan MCP OAuth return link and the origin check |
| `TRUST_PROXY` | off | `1` when Caddy, nginx or an ALB sits in front |
| `COOKIE_SECURE` | off | `1` to always mark the session cookie Secure |
| `DATA_DIR` | `./data` | Where all data lives |
| `SESSION_DAYS` | `30` | Session lifetime |
| `SETUP_CODE` | random | Fixed first-run setup code |
| `ALLOW_MEMBER_ADVISOR` | off | Let non-owner accounts use the AI advisor |
| `SEC_USER_AGENT` | generic | Name and email sent to SEC EDGAR (US stocks tab); SEC blocks anonymous clients |
| `ANTHROPIC_API_KEY` | none | AI advisor key (optional) |
| `AUTO_FUNDAMENTALS` | on | `0` disables the background fundamentals refresh |
| `PRICE_SOURCES` | `nse,yahoo,screener,google` | Price feed order (NSE = the exchange's own quote). Kite is not a default price source; add `kite` only if wanted. |
| `KITE_MCP_ENABLED` | on | `0` disables Zerodha Kite MCP |
| `ANGEL_*`, `DHAN_*`, `GROWW_*`, `INDMONEY_*` | none | The **owner's** broker credentials (optional; other accounts never see these) |
| `APP_URL` | `PUBLIC_URL` | Link added to Telegram alerts ("Open Equity Watchlist"); leave unset for no link |
| `TELEGRAM_API` | `https://api.telegram.org` | Telegram Bot API base (only change for a proxy or tests) |
| `PRICE_REFRESH_SECONDS` | `60` | How often prices refresh while the market is open (minimum 30). One shared run for all accounts. |
| `MARKET_ALWAYS_OPEN` | off | Testing only: `1` treats the market as open at any hour |
| `SWING_SCAN_SPACING_MS` | `1200` | Pause between chart requests in the daily swing-ideas scan (~185 stocks + watchlists, about 5 minutes after 15:50 IST on weekdays) |
| `SCREENER_BASE` | `https://www.screener.in` | Screener base URL (only change for a proxy or tests) |
| `YAHOO_CHART_BASE` | `https://query1.finance.yahoo.com` | Yahoo price-history base used for ETF valuation and trend data (only change for a proxy or tests) |

Telegram phone alerts (v4.4): each user connects their own bot from 🔔 Alerts → 📱 Phone alerts. The bot token is stored in that user's `notify.json` (MongoDB document `users/<id>/notify.json`), is never returned in full by the API, and is left out of user backups like broker logins. Alerts are sent by the server, so they arrive with the browser closed; the background swing check runs every 5 minutes during market hours.

---

## 9. Backups

Each user can also download a backup of their own account from the app (👤 → Backup & restore). That complements, but does not replace, the server backups below.

`DATA_DIR` is the entire state of the app. It contains broker sessions and API keys, so **treat it like a password store**.

- Take daily EBS snapshots (AWS Backup / Data Lifecycle Manager), **or**
- run a nightly tar to an **encrypted, private** S3 bucket (SSE-KMS, Block Public Access on, versioning on):
  ```bash
  tar czf - -C /var/lib equity-watchlist | aws s3 cp - s3://<private-bucket>/equity-watchlist/$(date +%F).tgz --sse aws:kms
  ```
- Encrypt the EBS volume (KMS).
- **Restore:** stop the service, put the folder back, fix ownership (`chown -R equity:equity`), then start the service.

---

## 10. Upgrades

```bash
sudo systemctl stop equity-watchlist
sudo cp -r /opt/equity-watchlist /opt/equity-watchlist.bak-$(date +%F)
sudo unzip -o equity-watchlist-vX.Y.zip -d /opt/ && sudo chown -R equity:equity /opt/equity-watchlist
sudo systemctl start equity-watchlist
```

Data in `DATA_DIR` is untouched by code upgrades. **Never** unzip a release over `DATA_DIR`.

---

## 11. Verification checklist (after deployment)

Run these from a machine outside AWS:

```bash
D=https://watchlist.example.com
curl -s  $D/healthz                       # {"ok":true}
curl -sI $D/ | grep -i location           # Location: /login   (redirected, no data)
curl -s  $D/api/stocks                    # {"message":"Please sign in.",...} with HTTP 401
curl -s  $D/api/holdings                  # 401, no holdings
curl -sI http://watchlist.example.com/    # redirects to https
curl -s  --max-time 5 http://<instance-public-ip>:4173/ || echo "port 4173 closed: good"
```

Then in a browser:

- [ ] The owner can sign in and sees their watchlist and holdings.
- [ ] A second test account (created by the owner) sees an **empty** watchlist and **none** of the owner's holdings.
- [ ] In the response headers, the session cookie shows `HttpOnly; Secure; SameSite=Lax`.
- [ ] Five wrong passwords give "Too many wrong attempts".
- [ ] The test account is removed afterwards (Manage accounts → Remove).

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The sign-in works, but you are sent straight back to `/login` | The cookie is Secure but the site was opened over http. Use https, or check `TRUST_PROXY=1` / `X-Forwarded-Proto`. |
| "Blocked: requests that change data must come from this app's own page." | `PUBLIC_URL` doesn't match the domain in the browser, or the proxy rewrites the `Host` header. Caddy and the ALB keep it by default. |
| The setup code is lost | It is in `$DATA_DIR/auth/setup-code.txt` until the owner exists. Or set `SETUP_CODE` and restart. |
| A user forgot their password | The owner resets it in the app (👤 → Manage accounts → Reset password). If the **owner** forgot: on the host run `sudo -u equity env DATA_DIR=/var/lib/equity-watchlist node /opt/equity-watchlist/scripts/reset-password.mjs <username>`, then `sudo systemctl restart equity-watchlist`. It prints a temporary password. |
| ALB target unhealthy | Set the health check path to `/healthz`; the SG must allow 4173 from the ALB SG; `HOST=0.0.0.0`. |
| Angel One / Dhan MCP login doesn't return | `PUBLIC_URL` must be the https domain; the OAuth return path is `/api/brokers/mcp/callback`. |
| Prices or fundamentals missing | Outbound 443 to the domains in section 2 is blocked, or the source is rate-limiting (the app backs off automatically). |
| Logs | `journalctl -u equity-watchlist -f` |

---

## 12b. Sign-in locations (optional)

👤 → Sign-in activity shows each device's city when the app runs behind **CloudFront**. Add an origin request policy that forwards `CloudFront-Viewer-City`, `CloudFront-Viewer-Country-Region-Name` and `CloudFront-Viewer-Country-Name`, and keep `TRUST_PROXY=1`. Cloudflare's `cf-ipcity` / `cf-ipcountry` headers also work. Without these headers the IP address is shown. No external geo-IP service is called.

## 12a. Install as an app (PWA)

Users can install the app on phones and desktops (👤 → Install as an app). This works only over **HTTPS**. `/manifest.webmanifest`, `/sw.js` and `/icons/*` are served without sign-in (they contain no data), and API responses are never cached on devices. After an upgrade, users get new code on their next page load.

## 13. Out of scope / known limits

- Single instance only (file-based storage; no horizontal scaling).
- No email-based password reset; the owner resets passwords in the app.
- No two-factor sign-in yet. If extra protection is wanted, put the app behind AWS WAF IP allow-listing, Cloudflare Access or a VPN.
