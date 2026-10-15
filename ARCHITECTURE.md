# Qennect Chat — System Architecture

Full-system design for a white-label, embeddable, multi-tenant chat SaaS platform. This
document covers the whole system as specified; **Slices 1–6 below are implemented in this
repository today.** Everything else is the intended shape for later slices, so each new
piece has an agreed contract to build against.

## Monorepo layout

```
apps/
  api/              NestJS backend + Socket.IO realtime gateway   [Slice 1 — built]
  admin/            Next.js admin dashboard                        [Slice 2 — built]
  mobile-example/   Example React Native host app (Expo)           [Slice 3 — built]
packages/
  shared-types/     Zod schemas + TS types: REST DTOs, WS events   [Slice 1 — built]
  ui-kit/           React Native Chat SDK + themeable UI Kit        [Slice 3 — built]
infra/
  docker/           Dockerfiles
  ci/               CI reference (active workflow lives in .github/workflows/ci.yml)
```

pnpm workspaces + Turborepo. `shared-types` is the single source of truth for the API/WS
contract — the admin dashboard and mobile SDK both depend on it so they can never silently
drift from what the backend actually implements.

## Slice 1: Backend Core (implemented)

NestJS API + Socket.IO gateway, Postgres (Prisma), Redis. See `apps/api/README.md` for
running it locally. Key design decisions:

- **Multi-tenancy**: every tenant-owned row carries `tenantId`. There is no cross-tenant
  query path — every service method that touches tenant data takes `tenantId` explicitly
  (from the JWT claim, never from client-supplied input) and filters on it. `ChannelsService
  .assertChannelMember` and `TenancyService.assertMembership` are the two chokepoints that
  must be called before touching channel/message data; unit tests cover the isolation.
  A future hardening step (not yet done) is Postgres Row-Level Security as defense in depth.
- **Message ordering & idempotency**: each channel has a `lastMessageSeq` counter. Sending a
  message atomically increments it inside a transaction and stamps the new row with that
  `seq`, giving strict per-channel ordering without relying on wall-clock time. The unique
  index on `(channelId, clientMsgId)` makes retried sends idempotent — the original message
  is returned rather than a duplicate being created, which is what makes at-least-once
  delivery from a flaky mobile connection safe.
- **Reconnect/replay**: clients track `lastSeq` per channel locally. On reconnect they emit
  `channel:sync` with `{ channelId, lastSeq }`; the server replays everything after that seq
  from Postgres. This avoids gaps without needing the server to buffer anything per-client.
- **Horizontal scaling**: the Socket.IO server uses `@socket.io/redis-adapter`, so
  `server.to(room).emit(...)` fans out correctly across multiple API instances behind a
  load balancer — a message sent on instance A reaches a client connected to instance B.
  Presence and rate limiting are also Redis-backed (not in-process) for the same reason.
- **Auth**: JWT access tokens (short-lived) + opaque refresh tokens stored as `Session` rows
  (device name, expiry, revocation). Refresh rotates the token and revokes the old one.
  `logout-all` revokes every active session for the user. Strategy pattern in
  `JwtModule`/`AuthService` leaves room for adding OAuth providers later without reshaping
  the token issuance path.
- **Rate limiting**: REST via `@nestjs/throttler`; WS message sends via a Redis fixed-window
  counter (`WsRateLimiterService`) since throttler doesn't cover gateway events.

## Slice 2: Admin Dashboard (implemented)

Next.js 14 (App Router) at `apps/admin`. "Core management" scope: login, tenant member list
+ role management, full channel list, and message moderation (soft-delete). See
`apps/admin/src/lib/api-client.ts` for the REST client and `apps/admin/src/lib/auth-context.tsx`
for session handling.

- **Auth**: same JWT access/refresh pair as the mobile SDK, obtained via `/auth/login`. Tokens
  live in `localStorage` (acceptable for an internal admin tool; swap for httpOnly cookies if
  this ships to a less-trusted audience) plus an in-memory `AuthProvider` context. `apiFetch`
  retries exactly once through `/auth/refresh` on a 401 before forcing re-login.
- **Admin-only API surface added to `apps/api`**: `GET /auth/me` (who-am-I, used by both admin
  and mobile), `PATCH /tenancy/members/:userId` (role change, `@Roles(ADMIN)`, ownership
  transfer explicitly excluded), `GET /channels/admin` (every tenant channel, not just the
  caller's), `DELETE /moderation/messages/:id` (soft-delete any message, `@Roles(ADMIN)`).
  The moderation delete route lives in `RealtimeModule` (as `ModerationController`) rather
  than `MessagesModule`, specifically so it can call `RealtimeGateway.broadcastMessageDeleted`
  without creating a `MessagesModule` ↔ `RealtimeModule` circular import — `RealtimeModule`
  already imports `MessagesModule` for the gateway's own use.
- **Server is the real gate**: role-based UI hiding (e.g. the role `<select>` on `/members`)
  is a convenience, not the security boundary — `RolesGuard` on the API enforces it either way.
- **Not built**: usage analytics, API keys UI, feature-flag UI, billing UI — out of scope for
  this pass (see Deferred below).

## Slice 3: Mobile Chat SDK (implemented)

React Native SDK at `packages/ui-kit`, demoed by `apps/mobile-example` (Expo). "Working chat
core" scope: SDK client (REST+WS, reconnect/resync), channel list, conversation screen,
composer, optimistic send/retry, typing/presence/read receipts, themeable UI Kit.

- **`ChatClient`** (`packages/ui-kit/src/client/ChatClient.ts`) is the framework-agnostic
  core: plain REST via `fetch`, WebSocket via `socket.io-client`. It owns reconnect with
  exponential backoff (self-driven, not socket.io's built-in reconnection, so resync order is
  guaranteed: resync every channel via `channel:sync` *then* flush the outgoing queue), an
  AsyncStorage-backed cache of channels/messages, and a persisted outgoing-message queue.
- **Optimistic send + reconciliation**: `sendMessage` generates a `clientMsgId`, appends a
  `pending: true` local message immediately, and reconciles it in place (matched by
  `clientMsgId`, never appended as a duplicate) when the server ack or a WS echo arrives —
  the exact same idempotency key the backend's unique `(channelId, clientMsgId)` index relies
  on. A failed send is marked `failed: true` and stays in the queue for `retryMessage` or the
  next automatic flush-on-reconnect.
- **React layer**: `ChatProvider` owns one `ChatClient` per (tenantId, userId); hooks
  (`useChannels`, `useMessages`, `useTyping`, `usePresence`, `useConnectionState`) subscribe
  to the client's typed pub-sub (`TypedEmitter` — a minimal hand-rolled emitter, since Node's
  `events` module isn't bundled in React Native by default).
- **Components**: `ChannelListScreen`/`ConversationScreen` use `@shopify/flash-list` for
  virtualization; `ThemeProvider` exposes light/dark tokens (colors, typography, spacing,
  radius) mergeable with a white-label `overrides` prop, following the OS color scheme unless
  overridden.
- **Auth is intentionally out of the SDK's scope**: `ChatClientConfig` takes `tenantId`,
  `userId`, and a `getAccessToken()` callback — the host app owns login/refresh and hands the
  SDK a valid token on demand, matching requirement #23 (tenantId/identity/token/theme
  injected by the host). `apps/mobile-example/App.tsx` shows the minimal shape of that host
  responsibility (calls `/auth/login` + `/auth/me` directly, outside `ui-kit`).
- **Not built (still deferred)**: a durable SQLite-backed offline store (current cache is
  AsyncStorage/JSON — fine for small channel lists and a queue, not for large message
  history), thread UI, reaction picker UI (reactions render read-only, though who-reacted is
  now shown — see Slice 6), search UI (the backend search endpoint exists as of Slice 4; no
  mobile screen consumes it yet).

## Slice 4: Feature-Parity Audit — Backend Gaps (implemented)

A feature-parity audit against the old Stream Chat-based app identified real backend gaps.
Per an explicit scoping decision, this slice covers backend-only: the 4-tier role system
(added MODERATOR), ban/unban, per-channel mute, ownership transfer, quoted replies +
mentions, and cross-channel message search. Mobile UI for these is explicitly deferred (see
below) — not forgotten, just out of scope for this pass.

- **Rank-based channel permissions**: `ChannelsService` replaced its old binary
  admin-or-not gate with a numeric rank model — `MEMBER=0, MODERATOR=1, ADMIN=2, OWNER=3`.
  A tenant ADMIN/OWNER always acts with effective rank `OWNER` for any channel in their
  tenant (the existing "community admin overall control" behavior, unchanged). This
  tightened `updateMemberRole`: previously any channel ADMIN could grant another ADMIN;
  now granting or modifying a role requires the actor to outrank both the target's current
  role and the role being granted, so ADMIN can promote up to MODERATOR but never ADMIN —
  only OWNER can grant ADMIN. Covered by the full rank-matrix test suite in
  `channels.service.spec.ts`.
- **Ban/unban** (`ChannelBan` model, unique on `(channelId, userId)`): actor rank ≥
  MODERATOR and target rank strictly below actor rank. Banning a group member also deletes
  their `ChannelMember` row (kicked out); banning in a DM leaves the fixed 2-person membership
  alone since a ban row alone is enough to block sending. Checked via `assertNotBanned` in
  `MessagesService.send`, alongside the existing `assertChannelMember` — surfaced to the
  client as a plain 403 ("You've been removed from this conversation") so the composer can
  render locked. This moderator-issued ban is distinct from the self-service DM block added
  in Slice 6, though both write the same `ChannelBan` row.
- **Mute**: a per-user, per-channel `ChannelMember.muted` boolean toggle, independent of
  role — any member can mute their own notifications, no elevated access required.
- **Transfer ownership**: only the channel's current OWNER may transfer; the target must
  already be a channel member. Deliberately not extended to the tenant-admin rank
  shortcut — reassigning ownership is a bigger action than the moderation-style actions that
  shortcut otherwise covers. `leave()` now rejects an OWNER leaving without transferring
  first, since there must always be exactly one owner.
- **Quoted replies + mentions**: `Message.quotedMessageId` (self-relation `QuotedReplies`)
  is deliberately distinct from the existing `parentId` thread relation — a quoted reply
  stays inline in the main conversation with a resolved preview (`{ id, authorId, body }`)
  attached to `MessageDto.quoted`, while a thread reply is filed away in its own view. A
  quote of a since-deleted message resolves to `quoted: null`. `MessageMention` rows persist
  the composer's already-known `mentionedUserIds` (no server-side @-text parsing) — surfaced on
  `MessageDto`, not yet consumed as push-targeting (Slice 5's push send is channel-wide, not
  mention-aware; that refinement is still open).
- **Message search**: `GET /messages/search` — `ILIKE` match on `body`, scoped server-side
  to channels the caller belongs to in the current tenant, excluding soft-deleted messages,
  cursor-paginated by `createdAt`. A known scaling limitation vs. real full-text search,
  accepted for this slice's data volumes.
- **Member directory search**: `GET /tenancy/members?search=` — case-insensitive match on
  email or display name, for group-creation/add-member pickers. No new "provisioning"
  endpoint was needed since tenant membership already *is* the chat identity in this system.
- **Not built (still deferred)**: the mobile UI for all of the above (ban/mute/transfer
  controls, quoted-reply composer UX, mention autocomplete, search screen), rich share cards,
  reply-privately, in-message link routing, full-screen media viewer.

## Slice 5: Push Notifications (implemented — mobile; web deferred)

Firebase Cloud Messaging, configured **per tenant** rather than once for the whole deployment
— this is a white-label platform, so each tenant sends push through its own Firebase project,
not a shared default. Covers mobile (Expo + `@react-native-firebase/messaging`); web push was
explicitly scoped out of this pass (there's no end-user web chat app in this repo yet, only the
Next.js admin dashboard — see Slice 2).

- **Per-tenant Firebase config** (`TenantPushConfig`, `apps/api/src/push/push-config.service.ts`):
  an admin pastes the tenant's Firebase service-account JSON (`PUT /push/tenant-config`,
  `@Roles(ADMIN)`) — downloaded from that Firebase project's console, not written by hand.
  Encrypted at rest with AES-256-GCM (`SecretCipher`, keyed by the deployment-wide
  `PUSH_CONFIG_ENCRYPTION_KEY` env var — this key protects *storage*, the Firebase credentials
  themselves are what's actually per-tenant) and never decrypted back out through any endpoint;
  `GET /push/tenant-config` only ever reports `{ configured, projectId, updatedAt }`.
- **Firebase Admin app per tenant** (`FirebaseAppRegistryService`): lazily builds and caches one
  `firebase-admin` App per tenant, self-healing on credential rotation by comparing the cached
  entry's config `updatedAt` against the DB row on every lookup rather than requiring a
  cross-service invalidation call (which would create a circular dependency with
  `PushConfigService`).
- **Device tokens** (`DeviceToken`, unique on `(tenantId, token)`): self-service
  `POST /push/device-tokens` / `DELETE /push/device-tokens/:token`. Upserts on the raw token
  (not per-user), so a logout/login-as-someone-else on the same device correctly moves the
  token to the new user rather than leaving a stale row.
- **Send pipeline** (`PushSenderService.notifyNewMessage`): hooked into both message-send paths
  (`RealtimeGateway.onMessageSend` and the REST fallback's `broadcastMessageNew`) as a
  fire-and-forget call — every failure is caught and logged there, never rethrown, so a broken
  Firebase config or FCM outage can't slow down or fail sending a message. Recipients are every
  other channel member who hasn't muted the channel (`ChannelMember.muted`); a tenant that
  hasn't configured Firebase yet is a silent no-op, not an error.
- **Badge count** (`BadgeService.computeUnreadBadge`): total unread messages across every
  non-muted channel a user belongs to, computed from each channel's `lastMessageSeq` against
  the user's `ReadReceipt.seq` (not by counting message rows, so it stays cheap regardless of
  channel history length). Sent as `apns.payload.aps.badge` — iOS applies this to the app icon
  automatically for background/killed delivery, no client-side badge-setting code needed for
  that case — and best-effort `android.notification.notificationCount` (numeric badges are
  launcher/OEM-dependent on Android).
- **Deep link**: every push carries a `PushNotificationData` payload
  (`{ type, tenantId, channelId, messageId }`) in FCM's `data` field. Stale/unregistered tokens
  FCM reports back (`messaging/registration-token-not-registered`) are pruned automatically
  after each send.
- **Mobile wiring** (`apps/mobile-example/push.ts`): deliberately host-app code, not part of
  `@qennect/ui-kit` — same split as image picking (see `Composer`'s doc comment) — so the SDK
  stays push-library-agnostic rather than hard-depending on
  `@react-native-firebase/messaging`. `usePushNotifications` requests permission, registers/
  refreshes the FCM token, and turns a notification tap (`onNotificationOpenedApp` /
  `getInitialNotification`, covering both backgrounded and fully-killed launch) into a
  deep-link `channelId`, wired in `App.tsx` to open `ConversationScreen` directly —
  `channelId`-only, since `ConversationScreen`'s `channel` prop is already optional for exactly
  this case (the full `ChannelDto` may not have loaded into the cached list yet). Requires a
  custom dev client (Expo Go can't load native modules); see
  `apps/mobile-example/README.md`'s "Push notifications" section for the two-sided Firebase
  setup (client config files + backend service account, both from the *same* Firebase project).
- **Not built (deferred)**: web push (no end-user web app exists yet to wire it into — see
  Slice 3's scope note), mention-aware targeting (push currently goes to every unmuted channel
  member, not filtered to `MessageMention` rows), per-user notification preferences beyond
  channel mute, local foreground-message banners (the `onMessage` hook point exists in
  `push.ts` but is a no-op), notification grouping/threading on the OS side.

## Slice 6: DM Block, Reaction Visibility, Activity-Sorted Channels (implemented — backend + mobile)

A second feature-parity pass, smaller than Slice 4, covering three independent gaps found in
day-to-day use of the mobile app rather than the original audit.

- **Self-service DM block** (`ChannelsService.blockInDm` / `unblockInDm` / `getDmBlockStatus`,
  exposed as `POST /channels/:id/block`, `DELETE /channels/:id/block`, and
  `GET /channels/:id/block-status`): either participant in a 1:1 DM can block the other
  with no moderator rank required — unlike Slice 4's ban/unban, which is moderator-gated and
  group-oriented. Blocking upserts a `ChannelBan` row for the *other* participant, which
  `assertNotBanned` then rejects sends on — the same enforcement path Slice 4 already built,
  reused rather than duplicated. Restricted to `ChannelType.DM` (`requireDmOtherMember` throws
  on a group channel — blocking a group makes no sense; that's what ban/kick are for).
  Unblocking only lifts a block *you* placed — if the other side blocked you instead, your own
  `unblockInDm` call is a no-op, since self-service unblock shouldn't let someone lift a block
  placed on them. `getDmBlockStatus` returns `{ blockedByMe, blockedMe }` so the client can
  render the correct state (composer locked vs. an "unblock" affordance) without guessing.
  Mobile wiring: `useDmBlockStatus(channelId, enabled)` hook (`packages/ui-kit`) loads status on
  mount and exposes a single `toggle()` that blocks or unblocks depending on current state.
- **Reactions — who reacted**: `MessagesService.toDto`'s per-emoji reaction grouping now
  carries `userIds` (every user who reacted with that emoji, oldest-first) alongside the
  existing `count` and `reactedByMe`, so the mobile UI can show *who* reacted, not just how
  many. Reactions are sorted by `createdAt` before grouping so the `userIds` order is stable
  and matches reaction recency. Rendered in `MessageRow` — still tap-to-view rather than a full
  reaction picker (adding a new reaction from the UI remains deferred, see Slice 3's
  "Not built" line).
- **Channel list sorted by activity**: `Channel.lastMessageAt` (new column, backfilled via
  migration `20260911120000_add_channel_last_message_at`) is stamped in the same transaction
  as `lastMessageSeq` on every send (`MessagesService.send`). `ChannelsService.listForUser` and
  `listAllForTenant` now order by `lastMessageAt desc` instead of `createdAt desc`, so a channel
  jumps to the top of the list the moment a new message lands in it — matching the "most
  recently active first" ordering users expect from any chat app, rather than a fixed
  creation-order list. A channel nobody has messaged in yet falls back to its `createdAt` (set
  as the initial value of `lastMessageAt` on channel creation).
- **Not built (still deferred)**: reaction picker UI for *adding* a reaction (see Slice 3),
  push notifications for DM blocks (a blocked user isn't told they were blocked, by design —
  matches common chat-app behavior of not revealing block state), unread-count re-sorting
  independent of `lastMessageAt` (e.g. pinning unread channels above merely-recent ones).

## Deferred (not yet built, any slice)

- **Web push**: no end-user web chat app exists in this repo yet (only the Next.js *admin*
  dashboard) — see Slice 5's scope note. The backend send pipeline isn't web-specific, so
  adding it later is mainly a client-side (service worker + FCM Web SDK) exercise.
- **Push refinements**: mention-aware targeting, per-user notification preferences beyond
  channel mute, foreground in-app banners, notification grouping — see Slice 5's own
  "Not built" line.
- **Link previews, pinned messages/bookmarks**: DB models and endpoints not yet added.
- **Admin**: usage analytics, API keys, feature flags, white-label branding config UI.
- **Mobile**: durable offline store beyond AsyncStorage, thread UI, and every Slice 4 backend
  capability listed above still needs its mobile screen/control.
- **Billing**: Stripe integration points (plan limits, usage metering) — tenant model has
  room for a `plan` field but nothing wired up yet.

## Recommended AWS deployment topology

Chosen for a balance of operational simplicity and horizontal scalability for a WebSocket
service, without taking on full Kubernetes operational overhead:

- **Compute**: ECS on Fargate for `apps/api`, running behind an **Application Load Balancer**.
  ALB supports WebSocket upgrade natively; because the Redis adapter fans out events across
  instances, sticky sessions are *not* required for correctness — any instance can serve any
  client — but enabling ALB sticky sessions is still a cheap latency win (avoids an extra
  cross-instance Redis hop on every event for a given connection). Autoscale ECS on CPU +
  connection count.
- **Database**: RDS PostgreSQL, Multi-AZ for production. Start on a single primary; the
  schema is already partition-friendly (`(tenantId, channelId, seq)` indexes) if a large
  tenant later needs `messages` partitioned by `tenantId` or by time range.
- **Cache/pubsub**: ElastiCache for Redis (cluster mode disabled to start — presence/rate
  limit/adapter traffic is small; enable cluster mode only once a single node saturates).
- **Object storage**: S3 for attachments, fronted by **CloudFront** for CDN delivery of
  images/files/voice notes. Presigned URLs for upload keep binary traffic off the API tier.
- **Push**: currently runs in-process in `apps/api` (`PushSenderService`, fire-and-forget from
  the message-send path — see Slice 5), which is fine at this scale since every failure is
  caught there and never blocks sending. If push volume or a flaky tenant's FCM calls ever
  start affecting API latency, the next step is splitting it into its own ECS service consuming
  a Redis/SQS queue fed by the gateway, not a redesign of the send logic itself.
- **Edge/static**: CloudFront in front of the admin dashboard (Next.js, deployed as an ECS
  service or Vercel-equivalent) and any static SDK assets.
- **Secrets**: AWS Secrets Manager for `DATABASE_URL`, JWT secrets, FCM/APNs credentials —
  injected into ECS task definitions as secrets, never baked into images.
- **Observability**: CloudWatch Logs (structured JSON via `pino`) + CloudWatch Container
  Insights for ECS metrics; add an APM (e.g. OpenTelemetry → X-Ray or a hosted alternative)
  once traffic justifies distributed tracing across REST + WS + push.

This keeps the whole system on managed AWS primitives (no self-managed Postgres/Redis/K8s),
which matters most early on: fewer moving parts to operate correctly while the product and
its multi-tenant load patterns are still being learned.

## Next-slice ordering (suggested)

1. Web push + an end-user web chat app to wire it into.
2. Durable mobile offline store (SQLite) + thread UI.
3. Admin analytics/API keys/billing UI.
4. AWS IaC (Terraform/CDK) + staging environment.
