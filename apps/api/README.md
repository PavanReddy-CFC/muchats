# @qennect/api

NestJS backend + Socket.IO realtime gateway for Qennect Chat. See `/ARCHITECTURE.md` at the
repo root for the full-system design; this README covers running this service locally.

## Local development

```bash
cp .env.example apps/api/.env   # from repo root
docker compose up -d postgres redis
pnpm install
pnpm --filter @qennect/shared-types build
pnpm --filter @qennect/api prisma:generate
pnpm --filter @qennect/api prisma:migrate
pnpm --filter @qennect/api seed
pnpm --filter @qennect/api dev
```

API listens on `http://localhost:3000`, Swagger docs at `/docs`, health check at `/healthz`.

Seeded demo login (tenant slug `demo`): `owner@demo.test` / `password123`.

## Testing

```bash
pnpm --filter @qennect/api test        # unit tests, no external services needed
pnpm --filter @qennect/api test:e2e    # requires postgres+redis running (docker compose)
```

## WebSocket contract

Connect with `io(url, { auth: { token: accessToken } })`. Events are defined in
`@qennect/shared-types` (`WsClientEvent` / `WsServerEvent`) — see `ws-events.ts` for the
full payload shapes. On reconnect, emit `channel:sync` with the last known `seq` per channel
to replay any missed messages.
