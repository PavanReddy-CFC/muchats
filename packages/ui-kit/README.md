# @qennect/ui-kit

React Native Chat SDK + themeable UI Kit. See `/ARCHITECTURE.md` for the full design.

## Usage

```tsx
import { ChatProvider, ThemeProvider, ChannelListScreen, ConversationScreen } from '@qennect/ui-kit';

<ThemeProvider mode="system">
  <ChatProvider
    config={{
      baseUrl: 'https://api.example.com',
      tenantId: currentTenantId,
      userId: currentUserId,
      getAccessToken: () => getFreshAccessTokenFromYourAuthFlow(),
    }}
  >
    {/* render ChannelListScreen / ConversationScreen, or use the hooks directly */}
  </ChatProvider>
</ThemeProvider>
```

Auth is intentionally outside the SDK's scope — the host app owns login/token refresh and
passes a `getAccessToken()` callback. See `apps/mobile-example/App.tsx` for a minimal
end-to-end example, including a stand-in login screen and a real refresh implementation.

**Important**: `getAccessToken` must always return a *currently valid* token, refreshing
proactively if needed — `ChatProvider` calls it on every (re)connect and REST request for the
whole lifetime of the client, and it does **not** get a fresh closure on every render
(`ChatProvider` only recreates its `ChatClient` if `tenantId`/`userId` change — see its own
doc comment). Concretely:

- **Don't** close over React state directly (`getAccessToken: () => someState.accessToken`) —
  that captures whichever value existed on the render where `ChatProvider` first mounted, and
  never sees later updates, even though the component keeps re-rendering with "fresh" props.
- **Do** read from a ref that you keep in sync every render (`ref.current = state` inline,
  no `useEffect` needed), and refresh the token proactively inside `getAccessToken` (check
  the JWT's `exp` claim, or track expiry yourself) rather than reactively after a failure —
  a WebSocket auth failure surfaces as a gateway-side "WS auth failed: jwt expired" log and a
  slower reconnect-with-backoff cycle instead of a clean retry.

`apps/mobile-example/App.tsx`'s `getAccessToken` does exactly this: decodes `exp`, refreshes
via `/auth/refresh` with an in-flight dedupe (so concurrent calls don't trigger parallel
refreshes), and updates both the ref and React state.

## Testing

```bash
pnpm --filter @qennect/ui-kit test        # ChatClient unit tests (mocked socket.io-client)
pnpm --filter @qennect/ui-kit typecheck
```

Not run in this repo's CI: a simulator/device pass. The component tree hasn't been exercised
outside `tsc`/lint — verify visually in `apps/mobile-example` before shipping UI changes.
