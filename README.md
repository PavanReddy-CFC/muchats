# Qennect Chat

Multi-tenant chat SaaS platform. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system
design. This file is the local dev quick-start for the three runnable pieces: **backend**,
**admin dashboard**, **mobile UI (Expo)**.

## Prerequisites

- Node >= 20, pnpm 9.x
- A Postgres server reachable from your machine (local install or Docker)
- Redis reachable from your machine (Docker is easiest — no native Windows build of Redis)

## 0. One-time setup (do this first)

```bash
cd D:\Qennect\Chat
pnpm install
pnpm --filter @qennect/shared-types build
```

### Database — create it once

If using a local Postgres install:
```bash
# adjust user/password to match what you actually have
psql -U postgres -h localhost -c "CREATE USER qennect WITH PASSWORD 'qennect'; CREATE DATABASE qennect_chat OWNER qennect;"
```
Or with Docker instead of a local install:
```bash
docker compose up -d postgres
```

### Redis — start it

```bash
docker compose up -d redis
```

### Configure the API's env file

```bash
cp .env.example apps/api/.env
```
Edit `apps/api/.env` → `DATABASE_URL` to match whatever user/password/db you actually created
above (the `.env.example` default assumes `qennect:qennect@localhost:5432/qennect_chat`).

### Create the schema + seed demo data

```bash
pnpm --filter @qennect/api prisma:generate
pnpm --filter @qennect/api prisma:migrate --name init
pnpm --filter @qennect/api seed
```

Seeded login (tenant slug `demo`): `owner@demo.test` / `password123` (OWNER),
`member@demo.test` / `password123` (MEMBER).

---

## 1. Backend (`apps/api`)

```bash
pnpm --filter @qennect/api dev
```

Runs at `http://localhost:3000` — REST + WebSocket gateway. Swagger docs at `/docs`, health
check at `/healthz`.

Quick smoke test once it's up:
```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"demo","email":"owner@demo.test","password":"password123"}'
```

## 2. Admin dashboard (`apps/admin`)

Requires the backend running (step 1). Next.js also defaults to port 3000, which collides
with the API, so run it on a different port:

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:3000" > apps/admin/.env.local
pnpm --filter @qennect/admin dev -- -p 3001
```

Open `http://localhost:3001/login` and sign in with the seeded demo owner above.

## 3. Mobile UI (`apps/mobile-example`, Expo)

Requires the backend running (step 1) and the SDK package built:

```bash
pnpm --filter @qennect/ui-kit build
pnpm --filter @qennect/mobile-example start
```

This opens the Expo dev tools (press `i` for iOS simulator, `a` for Android emulator, `w` for
web). On the app's login screen, the default API URL `http://localhost:3000` only works from
an iOS simulator or the web target — an Android emulator needs `http://10.0.2.2:3000`, and a
physical device needs your machine's LAN IP (e.g. `http://192.168.x.x:3000`). Sign in with the
same seeded demo owner.

### Testing the UI kit in a browser (no simulator needed)

```bash
pnpm --filter @qennect/mobile-example web
```

Opens `http://localhost:19006` in your browser via Expo's web target (React Native Web +
Metro). This is the fastest way to visually check `packages/ui-kit` components without
Xcode/Android Studio. First bundle can take ~15s.

Getting this working on Windows + pnpm required a few real fixes now baked into the repo:

- `apps/mobile-example/index.js` — a local entry point, because Expo's default
  `node_modules/expo/AppEntry.js` relies on a relative-path trick that breaks once Metro is
  configured to resolve pnpm's symlinked `node_modules` layout correctly on Windows.
- `apps/mobile-example/metro.config.js` — the documented Expo monorepo config (watches the
  workspace root, points at both `node_modules` locations), *plus* a forced single-copy
  resolution for `react`/`react-dom`/`react-native` via `resolver.resolveRequest`. Without
  that last part, `packages/ui-kit`'s own React devDependency (needed for its own build/tests)
  gets bundled as a *second, separate* React instance once Metro watches the whole workspace —
  symptom: `Invalid hook call` / `Cannot read properties of null (reading 'useState')` at
  runtime, even though everything typechecks and builds fine.
- `packages/ui-kit`'s React/React Native devDependency versions are pinned to match
  `apps/mobile-example`'s exactly, so pnpm dedupes them to the same physical package.
- An explicit `@babel/runtime` dependency — a transitive dependency Expo needs that pnpm's
  strict isolation doesn't hoist automatically.

If this ever regresses (e.g. after adding a new workspace package with its own React version),
symptoms are: identical bundle output despite config changes (stale Metro cache — clear
`apps/mobile-example/.expo` and any `metro-file-map-*`/`metro-cache*` dirs under your OS temp
folder), or the hook-call error above (check `grep -o "ReactVersion = '[0-9.]*'" bundle.js` for
more than one version — see `metro.config.js`'s comments for how the fix works).

---

## Verification (all packages)

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

E2E tests need Postgres + Redis reachable (a separate `qennect_chat_test` database, kept apart
from your dev data):
```bash
psql -U postgres -h localhost -c "CREATE DATABASE qennect_chat_test;"
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/qennect_chat_test" \
REDIS_URL="redis://localhost:6379/1" \
pnpm --filter @qennect/api exec prisma migrate deploy
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/qennect_chat_test" \
REDIS_URL="redis://localhost:6379/1" \
pnpm --filter @qennect/api test:e2e
```

## Stopping everything

```bash
docker compose down          # stops postgres/redis containers if you used Docker for them
# Ctrl+C in each terminal running `pnpm dev` / `pnpm start`
```
