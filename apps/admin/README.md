# @qennect/admin

Next.js admin dashboard: login, tenant member/role management, channel list, message
moderation. See `/ARCHITECTURE.md` for the full design; this covers running it locally.

## Local development

```bash
cp .env.example apps/admin/.env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:3000
pnpm install
pnpm --filter @qennect/shared-types build
pnpm --filter @qennect/admin dev
```

Requires `apps/api` running (see `apps/api/README.md`). Sign in with the seeded demo tenant:
workspace `demo`, `owner@demo.test` / `password123`.

Member role changes and message deletion require ADMIN or OWNER role; a MEMBER can view
members/channels but won't see the role selector or delete buttons.
