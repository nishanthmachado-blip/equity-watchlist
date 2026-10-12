# Running Equity Watchlist with Docker + MongoDB

From v4.0 the app stores everything in **MongoDB**: user accounts and sign-ins, watchlists, synced holdings, broker logins, net worth, goals, tax lots, fund X-rays and the shared market-data caches. The app container holds no data. Rebuilding, updating or moving it never resets anything, and each user's data stays private to their account.

```
 browser ──► app container (Node.js, port 4173) ──► mongo container (MongoDB 7, volume "mongo-data")
              optional on AWS: caddy container (HTTPS on 443) in front of the app
```

The same two files work everywhere: `docker-compose.yml` (app + MongoDB) and, for a public server, `docker-compose.aws.yml` (adds automatic HTTPS).

---

## 1. One-time setup (all platforms)

1. Install Docker:
   - **Windows 10/11:** Docker Desktop (uses WSL 2).
   - **Mac mini (Apple Silicon or Intel):** Docker Desktop or OrbStack.
   - **Linux / AWS:** Docker Engine plus the compose plugin.
2. Unzip the app and open a terminal in its folder.
3. Create your settings file:
   ```
   cp .env.example .env          (Windows PowerShell: copy .env.example .env)
   ```
   Then edit `.env` and set at least:
   ```
   MONGO_PASSWORD=ChooseAStrongPassword123      # letters and digits only
   SETUP_CODE=pick-a-one-time-code              # used once, to create the owner account
   ```
4. Start everything:
   ```
   docker compose up -d --build
   ```
5. Open **http://localhost:4173**, enter the setup code and create the owner account.

**Existing data comes in automatically.** If the `data` folder next to `docker-compose.yml` has data from an earlier version, it is imported into MongoDB on the very first start (empty database). The owner account inherits it.

---

## 2. Everyday commands

| What | Command |
|---|---|
| Start / update after unzipping a new version | `docker compose up -d --build` |
| Stop (data is kept) | `docker compose down` |
| Logs | `docker compose logs -f app` |
| Status / health | `docker compose ps` |
| Back up the database | `sh scripts/backup-mongo.sh` (Windows: `powershell -File scripts\backup-mongo.ps1`) |
| Forgot the owner password | `docker compose stop app && docker compose run --rm app node scripts/reset-password.mjs <username> && docker compose start app` |
| Restore a backup | `docker compose stop app` then `sh scripts/restore-mongo.sh backups/<file>` then `docker compose start app` |

> **Never run `docker compose down -v`.** The `-v` flag deletes the `mongo-data` volume, which is all your data.

---

## 3. Per platform

### Windows (Docker Desktop)
- Run the commands above in PowerShell from the app folder.
- To open it from your phone on the same Wi-Fi, set `BIND_ADDR=0.0.0.0` in `.env`, run `docker compose up -d`, and browse to `http://<PC's IP>:4173`. Allow port 4173 in Windows Firewall when asked.
- Docker Desktop must be running for the app to be up. Enable *Start Docker Desktop when you sign in*.

### Mac mini
- Same commands in Terminal. MongoDB 7 and Node images run natively on Apple Silicon.
- To keep it running 24×7:
  - System Settings → Energy → *Prevent automatic sleeping*;
  - Docker Desktop → *Start when you log in*.
  - The containers restart by themselves (`restart: unless-stopped`).
- For phone access at home, set `BIND_ADDR=0.0.0.0`. For outside access, use the AWS setup or a tunnel such as Tailscale, not router port-forwarding without HTTPS.

### AWS (EC2 or Lightsail, Ubuntu)
```
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 unzip
sudo usermod -aG docker $USER && newgrp docker
unzip equity-watchlist-v4.0.zip && cd equity-watchlist
cp .env.example .env && nano .env      # MONGO_PASSWORD, SETUP_CODE, DOMAIN=watchlist.example.com, SEC_USER_AGENT
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```
- Point the domain's DNS (A record) at the instance first. Caddy then gets the HTTPS certificate automatically.
- **Security group:** open 80 and 443 only. SSH (22) only from your own IP, or use SSM. Do not open 4173 or 27017.
- **Instance size:** 2 GB of memory is enough (`t3.small` / `t4g.small`). Encrypt the EBS volume. Turn on daily EBS snapshots, and/or run `scripts/backup-mongo.sh` from cron and copy the files to a private, encrypted S3 bucket.

### Using MongoDB Atlas (or another managed MongoDB) instead of the mongo container
Set `MONGO_URL` to the Atlas connection string in `.env` and start only the app:
```
docker compose build app
docker run -d --name equity-watchlist --restart unless-stopped --env-file .env -e HOST=0.0.0.0 -p 127.0.0.1:4173:4173 equity-watchlist:latest
```
In Atlas, allow only your server's IP in Network Access.

---

## 4. Good to know

- **One app container per database.** The app keeps a working copy of the data in memory and writes every change through to MongoDB. Don't run two app containers against the same database.
- **Health:** `GET /healthz` answers 200 when the app and the database are reachable, 503 when MongoDB is down. Docker uses it for the container health check.
- **Owner check:** signed in as the owner, `/api/storage` shows `mode: "mongo"`, the number of documents, and any failed writes.
- **What's in the database:** one collection, `app_data`. Each file the app used to write is now one document:
  - `_id` is the old path, e.g. `users/<account id>/watchlist.json`;
  - `owner` is the account id (`null` for shared market data);
  - `kind` is e.g. `watchlist`, `kite-holdings`, `networth`;
  - `data` holds the content.

  Accounts and sessions are under `auth/…` (passwords are scrypt hashes; session tokens are stored only as SHA-256 hashes).
- **Older CPUs:** MongoDB 5+ needs a CPU with AVX. On a very old PC, change `image: mongo:7` to `mongo:4.4` in `docker-compose.yml`.
- **Running without Docker** still works: `npm install && node server.mjs`. Without `MONGO_URL` it uses JSON files in `data/` as before; with `MONGO_URL` set it uses that database.
