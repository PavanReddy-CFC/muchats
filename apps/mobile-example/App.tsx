import React, { useCallback, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, TextInput, Pressable, View, useColorScheme } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  ChatProvider,
  ThemeProvider,
  ChannelListScreen,
  ConversationScreen,
  PickedImage,
  useChannels,
  useChatClient,
} from '@qennect/ui-kit';
import { usePushNotifications } from './push';

/** expo-image-picker is app-level, not part of @qennect/ui-kit — the SDK stays picker-
 *  library-agnostic (see Composer's onPickImage doc comment). This is the host app's job. */
async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    sizeBytes: asset.fileSize ?? 0,
  };
}

const DEFAULT_API_URL = 'http://localhost:3000';
const REFRESH_SAFETY_MARGIN_MS = 30_000; // refresh a bit before actual expiry

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

/** Decodes a JWT's `exp` claim without verifying the signature (verification is the server's
 *  job) — just enough to know when to proactively refresh instead of waiting for a 401/WS
 *  auth failure, which is what produced "WS auth failed: jwt expired" in the gateway logs. */
function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(decodeURIComponent(escape(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Auth is intentionally outside the SDK's scope (see ARCHITECTURE.md) — the host app owns
 *  login and hands ChatProvider a userId + token getter. This is a minimal stand-in for
 *  whatever real auth flow the host app already has, but the refresh behavior below is real:
 *  `ChatProvider` captures `getAccessToken` once and calls it on every (re)connect and REST
 *  request for the lifetime of the client, so it must always return a *currently valid*
 *  token — reading from a ref (not directly from React state) is what makes that work despite
 *  ChatProvider's own closure being fixed at mount time. */
function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: Session) => void }): JSX.Element {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [email, setEmail] = useState('owner@demo.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const loginRes = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug, email, password }),
      });
      if (!loginRes.ok) throw new Error(`Login failed (${loginRes.status})`);
      const tokens = await loginRes.json();

      const meRes = await fetch(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!meRes.ok) throw new Error('Failed to load profile');
      const me = await meRes.json();

      onLoggedIn({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: me.userId,
        tenantId: me.tenantId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.loginContainer}>
      <Text style={styles.title}>Qennect Chat</Text>
      <TextInput style={styles.input} value={apiUrl} onChangeText={setApiUrl} placeholder="API URL" autoCapitalize="none" />
      <TextInput style={styles.input} value={tenantSlug} onChangeText={setTenantSlug} placeholder="Workspace" autoCapitalize="none" />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={handleLogin} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
    </View>
  );
}

/** Lives inside ChatProvider (needs its context for useChatClient/useChannels) — owns which
 *  channel is open, by id rather than by object, so a push-notification tap can deep-link
 *  straight into a channel before its ChannelDto has necessarily loaded into the cached list
 *  (ConversationScreen's `channel` prop is optional for exactly this reason). */
function ChatContent(): JSX.Element {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const client = useChatClient();
  const { channels } = useChannels();
  usePushNotifications(client, setActiveChannelId);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  return activeChannelId ? (
    <View style={styles.flex}>
      <Pressable style={styles.backButton} onPress={() => setActiveChannelId(null)}>
        <Text>← Channels</Text>
      </Pressable>
      <ConversationScreen
        channelId={activeChannelId}
        channel={activeChannel}
        onPickImage={pickImage}
        onChannelDeleted={() => setActiveChannelId(null)}
      />
    </View>
  ) : (
    <ChannelListScreen onSelectChannel={(channel) => setActiveChannelId(channel.id)} />
  );
}

function ChatDemo({ session, onSessionRefreshed }: { session: Session; onSessionRefreshed: (session: Session) => void }): JSX.Element {
  // ChatProvider calls getAccessToken() on every (re)connect and REST request for the whole
  // lifetime of the client — it never sees a newer closure after the first render (see
  // ChatProvider's own doc comment on why it doesn't recreate the client on every prop
  // change). Reading from a ref, updated on every render, is what keeps it current.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const refreshInFlight = useRef<Promise<string> | null>(null);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const current = sessionRef.current;
    const expiryMs = getTokenExpiryMs(current.accessToken);
    if (expiryMs === null || expiryMs - Date.now() > REFRESH_SAFETY_MARGIN_MS) {
      return current.accessToken;
    }

    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        const res = await fetch(`${DEFAULT_API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
        const tokens = await res.json();
        const nextSession: Session = { ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
        sessionRef.current = nextSession;
        onSessionRefreshed(nextSession);
        return tokens.accessToken as string;
      })().finally(() => {
        refreshInFlight.current = null;
      });
    }
    return refreshInFlight.current;
  }, [onSessionRefreshed]);

  return (
    <ThemeProvider>
      <ChatProvider
        config={{
          baseUrl: DEFAULT_API_URL,
          tenantId: session.tenantId,
          userId: session.userId,
          getAccessToken,
        }}
      >
        <ChatContent />
      </ChatProvider>
    </ThemeProvider>
  );
}

export default function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const scheme = useColorScheme();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: scheme === 'dark' ? '#0B0D12' : '#FFFFFF' }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      {session ? (
        <ChatDemo session={session} onSessionRefreshed={setSession} />
      ) : (
        <LoginScreen onLoggedIn={setSession} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loginContainer: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12 },
  error: { color: '#DC2626' },
  button: { backgroundColor: '#111318', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  backButton: { padding: 12 },
});
