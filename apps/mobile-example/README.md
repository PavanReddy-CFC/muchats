# @qennect/mobile-example

Minimal Expo app demonstrating `@qennect/ui-kit` integration: a stand-in login screen (calls
`apps/api`'s `/auth/login` + `/auth/me` directly — auth is outside the SDK's scope), then
`ChatProvider` + `ThemeProvider` wrapping `ChannelListScreen`/`ConversationScreen`.

## Running

```bash
pnpm install
pnpm --filter @qennect/shared-types build
pnpm --filter @qennect/ui-kit build
pnpm --filter @qennect/mobile-example start
```

Requires `apps/api` running locally (see `apps/api/README.md`) and reachable from the device/
simulator at the API URL entered on the login screen (defaults to `http://localhost:3000`,
which only works from an iOS simulator or web — an Android emulator needs `10.0.2.2` and a
physical device needs your machine's LAN IP).

Sign in with the seeded demo tenant: workspace `demo`, `owner@demo.test` / `password123`.

**Not verified in this environment**: no simulator/device was available to actually launch
this app — only `tsc --noEmit` was run. Treat it as typechecked but not yet visually verified.

## Push notifications

Push (`push.ts`, wired into `App.tsx` as `usePushNotifications`) uses
`@react-native-firebase/messaging` — a native module, so **Expo Go cannot run this app**
anymore; you need a custom dev client (`npx expo prebuild` + `eas build --profile development`,
or a local `expo run:ios` / `expo run:android`).

Firebase is configured **per tenant** (this is a white-label platform — each tenant sends push
through its own Firebase project, see `apps/api/src/push/`). Two things need that tenant's
Firebase config:

1. **This app** (the client that receives push): download `google-services.json` (Android) and
   `GoogleService-Info.plist` (iOS) from the tenant's Firebase console (Project settings) and
   drop them in this directory — `app.json`'s `ios.googleServicesFile` /
   `android.googleServicesFile` already point at them, picked up by `expo prebuild` via the
   `@react-native-firebase/app` config plugin. They're gitignored (see root `.gitignore`) since
   they're specific to whichever tenant you're building for, never committed.
2. **The backend** (the sender): `PUT /push/tenant-config` (admin-only) with the *service
   account* JSON from that same Firebase project (Project settings → Service accounts →
   Generate new private key) — see `apps/api/.env.example` for the `PUSH_CONFIG_ENCRYPTION_KEY`
   this endpoint needs configured server-side first.

Both must point at the **same** Firebase project — a device registered against one project's
config can't receive push sent through Admin SDK credentials for a different project.

Once configured: a message notification includes the sender's name/preview, applies the
recipient's current unread badge count (`apns.payload.aps.badge` on iOS — applied by the OS
automatically in background/killed state; best-effort `notification_count` on Android), and
tapping it deep-links straight to the message's channel via `PushNotificationData` in the
payload's `data` field (see `push.ts`'s `extractDeepLink`).
