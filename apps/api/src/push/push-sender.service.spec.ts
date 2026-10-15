import { PushSenderService } from './push-sender.service';
import { ChannelsService } from '../channels/channels.service';
import { DeviceTokensService } from './device-tokens.service';
import { BadgeService } from './badge.service';
import { FirebaseAppRegistryService } from './firebase-app-registry.service';
import { DevicePlatform, MessageDto } from '@qennect/shared-types';

const sendEachForMulticast = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast })),
}));

function baseMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    tenantId: 't1',
    channelId: 'ch1',
    authorId: 'author',
    clientMsgId: 'c1',
    seq: 1,
    body: 'hello there',
    parentId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    reactions: [],
    attachments: [],
    quoted: null,
    mentionedUserIds: [],
    ...overrides,
  };
}

describe('PushSenderService.notifyNewMessage', () => {
  let channelsService: { listMembers: jest.Mock };
  let deviceTokens: { listForUsers: jest.Mock; removeStaleTokens: jest.Mock };
  let badge: { computeUnreadBadge: jest.Mock };
  let firebaseApps: { getApp: jest.Mock };
  let service: PushSenderService;

  beforeEach(() => {
    sendEachForMulticast.mockReset();
    channelsService = { listMembers: jest.fn() };
    deviceTokens = { listForUsers: jest.fn().mockResolvedValue([]), removeStaleTokens: jest.fn() };
    badge = { computeUnreadBadge: jest.fn().mockResolvedValue(0) };
    firebaseApps = { getApp: jest.fn() };
    service = new PushSenderService(
      channelsService as unknown as ChannelsService,
      deviceTokens as unknown as DeviceTokensService,
      badge as unknown as BadgeService,
      firebaseApps as unknown as FirebaseAppRegistryService,
    );
  });

  it('no-ops silently when the tenant has not configured Firebase', async () => {
    firebaseApps.getApp.mockResolvedValue(null);

    await service.notifyNewMessage('t1', baseMessage());

    expect(channelsService.listMembers).not.toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('excludes the sender and any member who muted the channel from recipients', async () => {
    firebaseApps.getApp.mockResolvedValue({});
    channelsService.listMembers.mockResolvedValue([
      { userId: 'author', displayName: 'Author', muted: false },
      { userId: 'muted-user', displayName: 'Muted', muted: true },
      { userId: 'recipient', displayName: 'Recipient', muted: false },
    ]);
    deviceTokens.listForUsers.mockResolvedValue([]);

    await service.notifyNewMessage('t1', baseMessage());

    expect(deviceTokens.listForUsers).toHaveBeenCalledWith('t1', ['recipient']);
  });

  it('sends one multicast per recipient with their own badge count, title, body, and deep-link data', async () => {
    firebaseApps.getApp.mockResolvedValue({});
    channelsService.listMembers.mockResolvedValue([
      { userId: 'author', displayName: 'Alice', muted: false },
      { userId: 'u2', displayName: 'Bob', muted: false },
    ]);
    deviceTokens.listForUsers.mockResolvedValue([
      { userId: 'u2', token: 'token-1', platform: DevicePlatform.IOS },
      { userId: 'u2', token: 'token-2', platform: DevicePlatform.ANDROID },
    ]);
    badge.computeUnreadBadge.mockResolvedValue(4);
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }, { success: true }], successCount: 2, failureCount: 0 });

    await service.notifyNewMessage('t1', baseMessage({ body: 'hi there' }));

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['token-1', 'token-2'],
        notification: { title: 'Alice', body: 'hi there' },
        data: { type: 'new_message', tenantId: 't1', channelId: 'ch1', messageId: 'm1' },
        apns: { payload: { aps: { badge: 4, sound: 'default' } } },
        android: { notification: { notificationCount: 4, sound: 'default' } },
      }),
    );
  });

  it('falls back to a photo/generic preview when the message has no body', async () => {
    firebaseApps.getApp.mockResolvedValue({});
    channelsService.listMembers.mockResolvedValue([
      { userId: 'author', displayName: 'Alice', muted: false },
      { userId: 'u2', displayName: 'Bob', muted: false },
    ]);
    deviceTokens.listForUsers.mockResolvedValue([{ userId: 'u2', token: 'token-1', platform: DevicePlatform.IOS }]);
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }], successCount: 1, failureCount: 0 });

    await service.notifyNewMessage(
      't1',
      baseMessage({ body: '', attachments: [{ id: 'a1', fileName: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }] }),
    );

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { title: 'Alice', body: '📷 Photo' } }),
    );
  });

  it('prunes device tokens FCM reports as unregistered', async () => {
    firebaseApps.getApp.mockResolvedValue({});
    channelsService.listMembers.mockResolvedValue([
      { userId: 'author', displayName: 'Alice', muted: false },
      { userId: 'u2', displayName: 'Bob', muted: false },
    ]);
    deviceTokens.listForUsers.mockResolvedValue([
      { userId: 'u2', token: 'stale-token', platform: DevicePlatform.IOS },
      { userId: 'u2', token: 'good-token', platform: DevicePlatform.IOS },
    ]);
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true },
      ],
      successCount: 1,
      failureCount: 1,
    });

    await service.notifyNewMessage('t1', baseMessage());

    expect(deviceTokens.removeStaleTokens).toHaveBeenCalledWith('t1', ['stale-token']);
  });

  it('never throws — a Firebase/FCM failure is caught and swallowed', async () => {
    firebaseApps.getApp.mockRejectedValue(new Error('firebase down'));

    await expect(service.notifyNewMessage('t1', baseMessage())).resolves.toBeUndefined();
  });
});
