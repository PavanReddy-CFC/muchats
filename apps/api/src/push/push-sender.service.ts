import { Injectable, Logger } from '@nestjs/common';
import type { App } from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';
import { MessageDto, PushNotificationData } from '@qennect/shared-types';
import { ChannelsService } from '../channels/channels.service';
import { BadgeService } from './badge.service';
import { DeviceTokensService, DeviceTokenRow } from './device-tokens.service';
import { FirebaseAppRegistryService } from './firebase-app-registry.service';

const MAX_BODY_PREVIEW_LENGTH = 120;

function isUnregisteredError(code: string | undefined): boolean {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}

/** Sends a "new message" push to every other channel member with a registered device token,
 *  skipping anyone who muted the channel. Deliberately fire-and-forget from the caller's
 *  perspective (see notifyNewMessage's doc comment) — a push-provider outage must never slow
 *  down or fail a message send. */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly deviceTokens: DeviceTokensService,
    private readonly badge: BadgeService,
    private readonly firebaseApps: FirebaseAppRegistryService,
  ) {}

  /** Call after a message has already been persisted and broadcast over WS — never awaited by
   *  the send path. Every failure is caught and logged here, never rethrown, so a broken
   *  Firebase config or an FCM outage can't turn into a failed message send. */
  async notifyNewMessage(tenantId: string, message: MessageDto): Promise<void> {
    try {
      const firebaseApp = await this.firebaseApps.getApp(tenantId);
      if (!firebaseApp) return; // tenant hasn't configured Firebase — no-op, not an error

      const members = await this.channelsService.listMembers(tenantId, message.channelId);
      const recipientIds = members.filter((m) => m.userId !== message.authorId && !m.muted).map((m) => m.userId);
      if (recipientIds.length === 0) return;

      const tokens = await this.deviceTokens.listForUsers(tenantId, recipientIds);
      if (tokens.length === 0) return;

      const tokensByUser = new Map<string, DeviceTokenRow[]>();
      for (const t of tokens) {
        const list = tokensByUser.get(t.userId) ?? [];
        list.push(t);
        tokensByUser.set(t.userId, list);
      }

      const senderName = members.find((m) => m.userId === message.authorId)?.displayName ?? 'New message';
      const body = this.previewBody(message);
      const data: PushNotificationData = {
        type: 'new_message',
        tenantId,
        channelId: message.channelId,
        messageId: message.id,
      };

      await Promise.all(
        Array.from(tokensByUser.entries()).map(([userId, userTokens]) =>
          this.sendToUser(tenantId, firebaseApp, userId, userTokens, senderName, body, data),
        ),
      );
    } catch (err) {
      this.logger.warn(`Push notification failed for channel ${message.channelId}: ${(err as Error).message}`);
    }
  }

  private previewBody(message: MessageDto): string {
    if (message.body) {
      return message.body.length > MAX_BODY_PREVIEW_LENGTH
        ? `${message.body.slice(0, MAX_BODY_PREVIEW_LENGTH)}…`
        : message.body;
    }
    return message.attachments.length > 0 ? '📷 Photo' : 'New message';
  }

  private async sendToUser(
    tenantId: string,
    firebaseApp: App,
    userId: string,
    tokens: DeviceTokenRow[],
    title: string,
    body: string,
    data: PushNotificationData,
  ): Promise<void> {
    const badgeCount = await this.badge.computeUnreadBadge(tenantId, userId);

    const response = await getMessaging(firebaseApp).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body },
      data: data as unknown as Record<string, string>,
      // iOS applies this to the app icon automatically, including when the app is backgrounded
      // or killed — no client-side badge-setting code needed for that case.
      apns: { payload: { aps: { badge: badgeCount, sound: 'default' } } },
      // Best-effort on Android: numeric badges are launcher/OEM-dependent (Samsung/Nova/etc
      // read this; stock Android's default launcher shows a dot, not a number).
      android: { notification: { notificationCount: badgeCount, sound: 'default' } },
    });

    const staleTokens = response.responses
      .map((r, i) => ({ r, token: tokens[i].token }))
      .filter(({ r }) => !r.success && isUnregisteredError(r.error?.code))
      .map(({ token }) => token);
    if (staleTokens.length > 0) {
      await this.deviceTokens.removeStaleTokens(tenantId, staleTokens);
    }
  }
}
