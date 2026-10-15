# Backend (`apps/api`) — Run Commands

All commands below are run from the repo root (`D:\Qennect\Chat` locally, or wherever you
clone it on a server) unless noted otherwise.

## 1. One-time setup

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env` → `DATABASE_URL` to match your actual Postgres user/password/db. The
`.env.example` default (`qennect:qennect@localhost:5432/qennect_chat`) is a placeholder —
this repo's own dev database has been running as `postgres:password@localhost:5432/qennect_chat`.

```bash
docker compose up -d postgres redis    # or point DATABASE_URL/REDIS_URL at your own instances
pnpm install
pnpm --filter @qennect/shared-types build
pnpm --filter @qennect/api prisma:generate
pnpm --filter @qennect/api prisma:migrate --name init
pnpm --filter @qennect/api seed
```

Seeded demo login (tenant slug `demo`): `owner@demo.test` / `password123`.

## 2. Run it (development, hot-reload)

```bash
pnpm --filter @qennect/api dev
```

Listens on `http://localhost:3000` by default (`PORT` in `apps/api/.env` — this repo's own
instance currently runs on **3010** because 3000 was already taken by an unrelated local
project; check `apps/api/.env` before assuming which port is live). Swagger docs at `/docs`,
health check at `/healthz`.

```bash
curl http://localhost:3000/healthz
```

## 3. Run it (production build, no hot-reload)

```bash
pnpm --filter @qennect/api build
pnpm --filter @qennect/api start        # runs dist/main.js
```

## 4. Database — extra seed scripts used in this project

```bash
# Seeds a fixed set of communities (tenants) by explicit id — see the file for the exact list.
cd apps/api && pnpm exec ts-node prisma/seed/seed-communities.ts

# Creates admin@qennect.com as OWNER of every community in seed-communities.ts, and resets
# the password for any existing member of those communities to the shared default.
cd apps/api && pnpm exec ts-node prisma/seed/seed-qennect-admin.ts
```

Both are idempotent (safe to re-run) — they upsert by id/email rather than duplicating rows.

## 5. Testing

```bash
pnpm --filter @qennect/api test        # unit tests — no external services needed
pnpm --filter @qennect/api test:e2e    # needs postgres+redis running, see below
```

The e2e suite targets a **separate** database so it never touches your dev data:
```bash
psql -U postgres -h localhost -c "CREATE DATABASE qennect_chat_test;"
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/qennect_chat_test" \
  pnpm --filter @qennect/api exec prisma migrate deploy
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/qennect_chat_test" \
REDIS_URL="redis://localhost:6379/1" \
  pnpm --filter @qennect/api test:e2e
```

## 6. Quick smoke test once it's running

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"demo","email":"owner@demo.test","password":"password123"}'
```

## 7. Stopping / restarting

```bash
# Find and stop a running dev instance (Windows):
#   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -like '*apps\api*'
#   Stop-Process -Id <pid> -Force
# Then just re-run the "Run it" command above.

docker compose down          # stops postgres/redis containers, if you used docker compose for them
```

---

## Production on a Linux server (CentOS/systemd/nginx)

Same build as above (§3), run as a service instead of a foreground process.

**`/etc/systemd/system/qennect-api.service`:**
```ini
[Unit]
Description=Qennect Chat — Backend API + WebSocket Gateway
After=network.target

[Service]
Type=simple
User=qennect
WorkingDirectory=/opt/qennect-chat/apps/api
EnvironmentFile=/opt/qennect-chat/apps/api/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp qennect-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qennect-api
sudo journalctl -u qennect-api -f
```

**nginx reverse proxy** — the WebSocket gateway needs the `Upgrade`/`Connection` headers that
a plain HTTP proxy block (like the admin portal's) doesn't set. Without these, REST calls work
fine but every WebSocket connection fails to upgrade:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;   # keep long-lived WS connections from being cut off
    }
}
```

Same CentOS gotchas as the admin portal deploy (see `infra/deploy/centos/README.md`):
`sudo setsebool -P httpd_can_network_connect 1` for SELinux, and open the port with
`firewall-cmd` if nginx isn't already allowed through.
