import { z } from 'zod';
import { DevicePlatform } from './enums';

export const RegisterDeviceTokenInputSchema = z.object({
  token: z.string().min(1),
  platform: z.nativeEnum(DevicePlatform),
});
export type RegisterDeviceTokenInput = z.infer<typeof RegisterDeviceTokenInputSchema>;

/// Pasted as-is from the Firebase console (Project settings -> Service accounts -> Generate
/// new private key). Each tenant configures its own Firebase project — this is a white-label
/// platform, so there is no shared/default project. Stored encrypted; see TenantPushConfigStatusDto
/// for what's readable back afterward.
export const SetTenantPushConfigInputSchema = z.object({
  serviceAccountJson: z.string().min(1),
});
export type SetTenantPushConfigInput = z.infer<typeof SetTenantPushConfigInputSchema>;

export interface TenantPushConfigStatusDto {
  configured: boolean;
  /// Parsed out of the service account at set-time, for a confirmation display — never the
  /// secret itself, which is never returned once stored.
  projectId: string | null;
  updatedAt: string | null;
}

/// The FCM `data` payload attached to every push this service sends — FCM only allows string
/// values in `data`, so every field here is a string even though channelId/messageId aren't
/// otherwise. The mobile client reads this on notification tap to deep-link straight to the
/// message's channel (see PushService.getInitialDeepLink / onNotificationTapped in ui-kit).
export interface PushNotificationData {
  type: 'new_message';
  tenantId: string;
  channelId: string;
  messageId: string;
}
