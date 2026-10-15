import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  RemoteMessage,
} from '@react-native-firebase/messaging';
import { DevicePlatform, PushNotificationData } from '@qennect/shared-types';
import { ChatClient } from '@qennect/ui-kit';

/** Push delivery + deep-link is deliberately host-app code, not part of @qennect/ui-kit — the
 *  SDK stays push-library-agnostic (same split as image picking; see Composer's doc comment).
 *  This is the reference wiring: request permission, register the FCM token with the backend
 *  (ChatClient.registerDeviceToken — see that method's doc comment for why it's a safe
 *  re-registerable no-op), and turn a notification tap into a deep-link channelId.
 *
 *  Requires a custom dev client (Expo Go can't load native modules) — see README.md. The
 *  default Firebase app is configured natively from google-services.json /
 *  GoogleService-Info.plist (per the app.json `googleServicesFile` entries), so getMessaging()
 *  needs no explicit app argument here. */
export function usePushNotifications(client: ChatClient, onDeepLink: (channelId: string) => void): void {
  const registeredToken = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribeTokenRefresh: (() => void) | undefined;
    let unsubscribeForeground: (() => void) | undefined;
    let unsubscribeOpenedApp: (() => void) | undefined;
    let cancelled = false;

    function extractDeepLink(remoteMessage: RemoteMessage | null): void {
      const data = remoteMessage?.data as Partial<PushNotificationData> | undefined;
      if (data?.type === 'new_message' && data.channelId) onDeepLink(data.channelId);
    }

    async function register(token: string): Promise<void> {
      if (token === registeredToken.current) return;
      registeredToken.current = token;
      const platform = Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID;
      await client.registerDeviceToken(token, platform).catch(() => undefined);
    }

    (async () => {
      const messaging = getMessaging();

      // requestPermission is flagged deprecated upstream in favor of a dedicated permissions
      // library (react-native-permissions / expo-notifications) — kept here rather than
      // pulling in another dependency for this reference wiring; a production host app should
      // switch to one of those for the permission *prompt* while still using the
      // @react-native-firebase/messaging calls below for the token and message handling.
      const authStatus = await requestPermission(messaging);
      const granted = authStatus === AuthorizationStatus.AUTHORIZED || authStatus === AuthorizationStatus.PROVISIONAL;
      if (!granted || cancelled) return;

      const token = await getToken(messaging);
      if (!cancelled) await register(token);

      // Tapping a notification while the app is backgrounded (not killed).
      unsubscribeOpenedApp = onNotificationOpenedApp(messaging, extractDeepLink);
      // The app was launched *by* tapping a notification (was fully killed).
      const initial = await getInitialNotification(messaging);
      if (!cancelled) extractDeepLink(initial);

      // FCM tokens rotate (app reinstall, restore, OS-driven refresh) — re-register on change.
      unsubscribeTokenRefresh = onTokenRefresh(messaging, register);

      // Foreground messages don't produce a system notification on their own; this is left as
      // a hook point for a host app that wants to show an in-app banner. The badge count in
      // the payload is already applied by the OS for background/killed delivery (see
      // PushSenderService's doc comment on the apns.payload.aps.badge field) — there's
      // deliberately no local badge-clearing code here to keep this reference wiring to what
      // @react-native-firebase/messaging itself provides.
      unsubscribeForeground = onMessage(messaging, async () => undefined);
    })();

    return () => {
      cancelled = true;
      unsubscribeTokenRefresh?.();
      unsubscribeForeground?.();
      unsubscribeOpenedApp?.();
    };
  }, [client, onDeepLink]);
}

/** Call on logout, before tearing down the ChatClient, so this device stops receiving push for
 *  the account that just signed out. */
export async function unregisterCurrentDeviceToken(client: ChatClient): Promise<void> {
  const token = await getToken(getMessaging()).catch(() => null);
  if (token) await client.unregisterDeviceToken(token).catch(() => undefined);
}
