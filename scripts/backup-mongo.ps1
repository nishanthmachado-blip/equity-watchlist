# Windows PowerShell: back up the database to .\backups (run from the app folder).
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path backups | Out-Null
$envs = @{}; if (Test-Path .env) { Get-Content .env | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object { $envs[$Matches[1]] = $Matches[2].Trim('"') } }
$user = if ($envs.MONGO_USER) { $envs.MONGO_USER } else { "ewadmin" }; $db = if ($envs.MONGO_DB) { $envs.MONGO_DB } else { "equity_watchlist" }
$file = "backups\equity-watchlist-$(Get-Date -Format yyyyMMdd-HHmmss).archive.gz"
docker compose exec -T mongo mongodump --quiet --archive=/tmp/backup.gz --gzip -u $user -p $envs.MONGO_PASSWORD --authenticationDatabase admin --db $db
docker compose cp mongo:/tmp/backup.gz $file
Write-Host "Saved $file"
