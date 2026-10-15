# Channels API — group management, discovery & activity ordering

Covers the endpoints added / changed on branch `feature/channel-group-management`.

- **Base URL:** `http://<host>:<PORT>` (default port `3000`), prefixed with `API_PREFIX` if set (e.g. `/api` → `http://host:3000/api/...`). Swagger UI at `GET /docs`.
- **Auth:** every route here requires `Authorization: Bearer <accessToken>` (from `POST /auth/login` or `POST /auth/federated-login`). The token carries `tenantId`, `sub` (userId) and `role` (this tenant's `TenantRole`); all operations are scoped to the token's tenant.
- **Content type:** `application/json`.
- **Error shape:** `{ "statusCode": <n>, "message": <string | string[] | {path,message}[]> }`. Body-validation failures return `400` with `message` as an array of `{ "path": "...", "message": "..." }`.

---

## Data types

### `ChannelDto`

```jsonc
{
  "id": "uuid",
  "tenantId": "uuid",
  "type": "PUBLIC" | "PRIVATE" | "DM",
  "name": "string | null",              // null for DMs
  "description": "string | null",        // NEW — always null for DMs
  "avatarUrl": "string | null",          // NEW — always null for DMs
  "postingPolicy": "EVERYONE" | "ADMINS_ONLY",  // NEW — always EVERYONE for DMs
  "createdAt": "ISO-8601",
  "lastMessageSeq": 0,
  "lastMessagePreview": "string | null", // NEW — text of the latest surviving message, ≤140 chars, "📎 Attachment" for attachment-only, null when the channel is empty
  "lastMessageAt": "ISO-8601 | null",    // NEW — timestamp of the latest surviving message; null when empty
  "memberCount": 12                      // present on /admin and /discover only
}
```

New fields are **additive** — existing clients keep working.

### `ChannelMemberDto`

```jsonc
{ "userId": "string", "email": "string", "displayName": "string",
  "role": "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER", "joinedAt": "ISO-8601", "muted": false }
```

### `ChannelPostingPolicy`

| Value | Who may send messages in the channel |
|---|---|
| `EVERYONE` | any channel member (default) |
| `ADMINS_ONLY` | channel `OWNER`/`ADMIN`, or a tenant community admin (`TenantRole` `ADMIN`/`OWNER`). Everyone else is read-only. |

### Rank model (for authorization notes below)

`OWNER > ADMIN > MODERATOR > MEMBER` within a channel. A tenant community admin (`TenantRole` `ADMIN`/`OWNER`) acts with **effective `OWNER` rank on every channel** in their tenant.

---

## `POST /channels` — create channel *(updated)*

Creates a channel; the caller becomes its `OWNER`.

**Body** (`CreateChannelInput`)

| Field | Type | Rules |
|---|---|---|
| `type` | `"PUBLIC" \| "PRIVATE" \| "DM"` | required |
| `name` | string | 1–80 chars; optional. Ignored (stored `null`) for `DM` |
| `description` | string | **new** — ≤500 chars; optional. Ignored for `DM` |
| `avatarUrl` | string (URL) | **new** — valid URL, ≤2048 chars; optional. Ignored for `DM` |
| `postingPolicy` | `"EVERYONE" \| "ADMINS_ONLY"` | **new** — optional, default `EVERYONE`. Forced `EVERYONE` for `DM` |
| `memberUserIds` | string[] | other members to add as `MEMBER`; for `DM` exactly one other user |

**Response** `201` → `ChannelDto`. A `DM` that already exists between the two users is returned as-is (not duplicated).

**Example**

```http
POST /channels
Authorization: Bearer <token>

{
  "type": "PUBLIC",
  "name": "Announcements",
  "description": "Official club notices",
  "avatarUrl": "https://cdn.example.com/ann.png",
  "postingPolicy": "ADMINS_ONLY",
  "memberUserIds": ["member-1", "member-2"]
}
```

**Errors:** `400` validation · `403` caller not a member of the tenant · `403` `DM` with no `memberUserIds`.

---

## `PATCH /channels/:id` — edit group *(new)*

Edit a group channel's settings. **At least one field is required.**

**Auth:** channel `ADMIN` rank or higher (a tenant community admin qualifies).

**Body** (`UpdateChannelInput`) — all optional:

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1–80 chars |
| `type` | `"PUBLIC" \| "PRIVATE"` | may switch between the two; **`DM` is rejected** (`400 "type cannot be DM"`) |
| `description` | string \| `null` | ≤500 chars; send `null` to clear |
| `avatarUrl` | string (URL) \| `null` | valid URL, ≤2048 chars; send `null` to clear |
| `postingPolicy` | `"EVERYONE" \| "ADMINS_ONLY"` | change the posting policy |

**Response** `200` → updated `ChannelDto`.

**Example**

```http
PATCH /channels/1f2e.../
Authorization: Bearer <token>

{ "name": "Announcements 2025", "description": null, "postingPolicy": "EVERYONE" }
```

**Errors:**
| Status | When |
|---|---|
| `400` | empty body (`"Provide at least one field to update"`), validation, or `type: "DM"` |
| `400` | target channel is a `DM` (`"A direct message has no editable settings"`) |
| `403` | caller below channel `ADMIN` rank |
| `404` | channel not found in the caller's tenant |

---

## `GET /channels/discover` — browse joinable channels *(new)*

Lists `PUBLIC` channels in the caller's tenant that they **are not already a member of** and **are not banned from**, ordered by member count descending (busiest first), then newest.

**Auth:** any tenant member.

**Response** `200` → `ChannelDto[]` (each includes `memberCount`).

**Example**

```http
GET /channels/discover
Authorization: Bearer <token>
```

Join one with the existing `POST /channels/:id/join`.

**Errors:** `403` caller not a member of the tenant.

---

## `POST /channels/:id/members` — add members after creation *(new)*

Adds existing community members to a group channel. Already-members are silently skipped; duplicate ids in the request are de-duplicated.

**Auth:** channel `ADMIN` rank or higher (tenant community admin qualifies).

**Body** (`AddChannelMembersInput`)

| Field | Type | Rules |
|---|---|---|
| `userIds` | string[] | 1–100 ids; each must be a member of the tenant and not banned from the channel |

**Response** `200` → `ChannelMemberDto[]` — the channel's full member list after the change.

**Example**

```http
POST /channels/1f2e.../members
Authorization: Bearer <token>

{ "userIds": ["member-7", "member-8"] }
```

**Errors:**
| Status | When |
|---|---|
| `400` | validation, or target channel is a `DM` (`"Cannot add members to a direct message"`) |
| `400` | a `userId` is not a member of this community (`"One or more users are not members of this community"`) |
| `400` | a `userId` is banned from the channel (`"...unban them first"`) |
| `403` | caller below channel `ADMIN` rank |
| `404` | channel not found in the caller's tenant |

---

## Channel list ordering & previews *(changed behaviour)*

`GET /channels` and `GET /channels/admin` now order by **most recent activity first**: `lastMessageAt` descending, channels with no messages last, then `createdAt` descending. Responses carry `lastMessagePreview` / `lastMessageAt` (see `ChannelDto`).

- Set on every send (in the same transaction as `lastMessageSeq`).
- When the **latest** message is edited or deleted, the preview/timestamp are recomputed from the previous surviving message (or `null` if none remains). Edits do not re-sort the list; a new message does.

---

## Posting-policy enforcement *(changed behaviour)*

When a channel's `postingPolicy` is `ADMINS_ONLY`, sending a message is rejected for anyone below channel `ADMIN` rank (tenant community admins still may). Enforced on **both** send paths:

- `POST /messages` (REST) → `403 "Only channel admins can post in this channel"`
- WebSocket `message:send` → ack `{ "ok": false, "error": "Only channel admins can post in this channel" }`

`EVERYONE` channels are unaffected.

---

## Migrations

Apply before deploying this branch:

```bash
cd apps/api
pnpm prisma:deploy      # applies both migrations
pnpm prisma:generate
```

| Migration | Adds |
|---|---|
| `20260908120000_add_channel_last_message` | `channels.lastMessagePreview`, `channels.lastMessageAt`, index `(tenantId, lastMessageAt)` |
| `20260908130000_add_channel_group_settings` | enum `ChannelPostingPolicy`, `channels.description`, `channels.avatarUrl`, `channels.postingPolicy` (default `EVERYONE`) |

Both are additive (nullable columns + a defaulted column) — safe on a live table.
