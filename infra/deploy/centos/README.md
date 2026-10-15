# Deploying the Admin Portal (`apps/admin`) on CentOS

Scope: just `apps/admin` (Next.js), assuming Node.js and nginx are already installed on the
box. The backend API is deployed separately — this only needs its **URL**.

## 0. Prerequisites check

```bash
node -v      # need >=20 — if older, install via nodesource or nvm and re-check
which nginx
which pnpm || sudo npm install -g pnpm@9
```

If Node is missing or too old on a stock CentOS box:
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

## 1. Get the code onto the server

```bash
sudo mkdir -p /opt/qennect-chat
sudo chown $(whoami):$(whoami) /opt/qennect-chat
git clone https://github.com/Cloud-First-Computing/muchats.git /opt/qennect-chat
cd /opt/qennect-chat
pnpm install --frozen-lockfile
pnpm --filter @qennect/shared-types build
```

## 2. Configure — before building, not after

**This is the step that bites people**: Next.js inlines every `NEXT_PUBLIC_*` variable into
the client bundle *at build time*. Setting it only in a runtime `.env` that `next start` reads
later does nothing for the browser-side code — the API URL has to be present when you run
`next build`.

```bash
cat > apps/admin/.env.production <<'EOF'
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
EOF
```

Use the **public, internet-reachable** URL of the backend here (not `localhost` — this value
ships to every browser that loads the admin portal).

## 3. Build

```bash
cd /opt/qennect-chat
pnpm --filter @qennect/admin build
```

Confirm it actually picked up the URL:
```bash
grep -r "api.yourdomain.com" apps/admin/.next/static/chunks/*.js | head -1
```
If that finds nothing, the env var wasn't set before the build — fix step 2 and rebuild.

## 4. Run it as a service (systemd)

Copy the unit file from this repo, adjusting `User=` and `WorkingDirectory=` if you cloned
somewhere other than `/opt/qennect-chat`. Check where `pnpm` actually lives first —
`ExecStart=` needs an absolute path, and it varies by how pnpm was installed:

```bash
which pnpm     # e.g. /usr/local/bin/pnpm — update ExecStart in the unit file to match
```

```bash
sudo useradd -r -s /sbin/nologin qennect 2>/dev/null || true
sudo chown -R qennect:qennect /opt/qennect-chat
sudo cp infra/deploy/centos/qennect-admin.service /etc/systemd/system/
sudo sed -i "s|/usr/bin/pnpm|$(which pnpm)|" /etc/systemd/system/qennect-admin.service
sudo systemctl daemon-reload
sudo systemctl enable --now qennect-admin
sudo systemctl status qennect-admin
```

Note the unit's `EnvironmentFile=.../apps/admin/.env.production` line — it's fine for this to
also be the same file you built with; `next start` doesn't re-read `NEXT_PUBLIC_*` at runtime
(those are already baked in) but this keeps one file as the source of truth if you add
server-only env vars later.

Check it's actually listening:
```bash
curl -s http://127.0.0.1:3001/login | grep -o "<title>.*</title>"
```

## 5. nginx reverse proxy

```bash
sudo cp infra/deploy/centos/nginx-admin.conf /etc/nginx/conf.d/qennect-admin.conf
sudo sed -i 's/admin.example.com/admin.yourdomain.com/' /etc/nginx/conf.d/qennect-admin.conf
sudo nginx -t && sudo systemctl reload nginx
```

### CentOS-specific gotchas

- **SELinux** (enabled by default) blocks nginx from proxying to a local port unless told
  otherwise. If `curl http://admin.yourdomain.com/login` from outside the box hangs or 502s
  while the direct `curl 127.0.0.1:3001` in step 4 worked, this is almost always why:
  ```bash
  sudo setsebool -P httpd_can_network_connect 1
  ```
- **firewalld**: open 80/443 if not already:
  ```bash
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --permanent --add-service=https
  sudo firewall-cmd --reload
  ```

## 6. HTTPS

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d admin.yourdomain.com
```
Certbot edits the nginx config in place to add the 443 block and redirect — no manual TLS
config needed. It also sets up auto-renewal via a systemd timer (`systemctl list-timers | grep certbot`).

## 7. Verify end-to-end

```bash
curl -sI https://admin.yourdomain.com/login | head -1     # expect 200
```
Then in a browser: sign in with a real account and confirm the members/channels pages load
data from the API URL you configured in step 2 (open devtools → Network and check the request
host matches).

## Redeploying after a code change

```bash
cd /opt/qennect-chat
git pull
pnpm install --frozen-lockfile
pnpm --filter @qennect/shared-types build
pnpm --filter @qennect/admin build
sudo systemctl restart qennect-admin
```

## Logs

```bash
sudo journalctl -u qennect-admin -f
```
