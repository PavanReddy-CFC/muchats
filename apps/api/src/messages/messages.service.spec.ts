import { ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

function makePrismaMock() {
  const mock: Record<string, unknown> = {
    message: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    channel: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    reaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    readReceipt: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
  mock.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(mock));
  return mock as unknown as {
    message: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    channel: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    reaction: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    readReceipt: { upsert: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
}

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    tenantId: 't1',
    channelId: 'ch1',
    authorId: 'u1',
    clientMsgId: 'c1',
    seq: 1n,
    body: 'hello',
    parentId: null,
    quotedMessageId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    reactions: [],
    attachments: [],
    mentions: [],
    quotedMessage: null,
    ...overrides,
  };
}

describe('MessagesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let channelsService: {
    assertChannelMember: jest.Mock;
    assertNotBanned: jest.Mock;
    assertCanPost: jest.Mock;
  };
  let service: MessagesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    channelsService = {
      assertChannelMember: jest.fn().mockResolvedValue(undefined),
      assertNotBanned: jest.fn().mockResolvedValue(undefined),
      assertCanPost: jest.fn().mockResolvedValue(undefined),
    };
    service = new MessagesService(
      prisma as unknown as PrismaService,
      channelsService as unknown as ChannelsService,
    );
  });

  describe('send (idempotency)', () => {
    const tenantId = 't1';
    const userId = 'u1';
    const input = {
      clientMsgId: 'c1',
      channelId: 'ch1',
      body: 'hello',
      mentionedUserIds: [] as string[],
      attachmentIds: [] as string[],
    };

    it('returns the existing message without creating a new one on a retried send', async () => {
      prisma.message.findUnique.mockResolvedValue(baseMessage());

      const result = await service.send(tenantId, userId, input);

      expect(result.id).toBe('m1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('assigns the next per-channel seq and creates the message on first send', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.channel.update.mockResolvedValue({ lastMessageSeq: 5n });
      prisma.message.create.mockResolvedValue(baseMessage({ id: 'm2', seq: 5n }));

      const result = await service.send(tenantId, userId, input);

      expect(result.seq).toBe(5);
      expect(prisma.channel.update).toHaveBeenCalledWith({
        where: { id: 'ch1' },
        data: {
          lastMessageSeq: { increment: 1 },
          lastMessageAt: expect.any(Date),
          lastMessagePreview: 'hello',
        },
      });
    });

    it('stores an attachment marker as the channel preview for a body-less message', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.channel.update.mockResolvedValue({ lastMessageSeq: 1n });
      prisma.message.create.mockResolvedValue(baseMessage({ id: 'm4', seq: 1n, body: '' }));

      await service.send(tenantId, userId, {
        clientMsgId: 'c4',
        channelId: 'ch1',
        body: '',
        mentionedUserIds: [],
        attachmentIds: ['att-1'],
      });

      expect(prisma.channel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastMessagePreview: '📎 Attachment' }) }),
      );
    });
  });

  describe('send (quoted replies + mentions)', () => {
    const tenantId = 't1';
    const userId = 'u1';

    it('persists quotedMessageId and mention rows on create', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.channel.update.mockResolvedValue({ lastMessageSeq: 2n });
      prisma.message.create.mockResolvedValue(
        baseMessage({
          id: 'm3',
          seq: 2n,
          quotedMessageId: 'qm1',
          quotedMessage: { id: 'qm1', authorId: 'u2', body: 'original', deletedAt: null },
          mentions: [{ userId: 'u2' }],
        }),
      );

      const result = await service.send(tenantId, userId, {
        clientMsgId: 'c2',
        channelId: 'ch1',
        body: 'reply',
        quotedMessageId: 'qm1',
        mentionedUserIds: ['u2'],
        attachmentIds: [],
      });

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quotedMessageId: 'qm1',
            mentions: { create: [{ userId: 'u2' }] },
          }),
        }),
      );
      expect(result.quoted).toEqual({ id: 'qm1', authorId: 'u2', body: 'original' });
      expect(result.mentionedUserIds).toEqual(['u2']);
    });

    it('resolves a null quoted preview when the quoted message was soft-deleted', async () => {
      prisma.message.findUnique.mockResolvedValue(
        baseMessage({
          quotedMessageId: 'qm1',
          quotedMessage: { id: 'qm1', authorId: 'u2', body: '', deletedAt: new Date() },
        }),
      );

      const result = await service.send(tenantId, userId, {
        clientMsgId: 'c1',
        channelId: 'ch1',
        body: 'hello',
        mentionedUserIds: [],
        attachmentIds: [],
      });

      expect(result.quoted).toBeNull();
    });
  });

  describe('send (ban check)', () => {
    it('blocks sending when the caller has been banned from the channel', async () => {
      channelsService.assertNotBanned.mockRejectedValue(
        new ForbiddenException("You've been removed from this conversation"),
      );

      await expect(
        service.send('t1', 'banned-user', {
          clientMsgId: 'c1',
          channelId: 'ch1',
          body: 'hello',
          mentionedUserIds: [],
          attachmentIds: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('send (posting policy)', () => {
    it('blocks sending when the channel restricts posting to admins and the caller is not one', async () => {
      channelsService.assertCanPost.mockRejectedValue(
        new ForbiddenException('Only channel admins can post in this channel'),
      );

      await expect(
        service.send('t1', 'plain-member', {
          clientMsgId: 'c1',
          channelId: 'ch1',
          body: 'hello',
          mentionedUserIds: [],
          attachmentIds: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('list (cursor pagination)', () => {
    it('filters by seq greater than the provided cursor', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await service.list('t1', 'u1', { channelId: 'ch1', cursor: 10, limit: 50 });

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ seq: { gt: 10n } }),
        }),
      );
    });

    it('omits the seq filter when no cursor is given', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await service.list('t1', 'u1', { channelId: 'ch1', limit: 50 });

      const call = prisma.message.findMany.mock.calls[0][0];
      expect(call.where.seq).toBeUndefined();
    });
  });

  describe('search', () => {
    it('scopes the search to channels the caller belongs to', async () => {
      prisma.message.findMany.mockResolvedValue([
        { ...baseMessage(), channel: { name: 'general' } },
      ]);

      const results = await service.search('t1', 'u1', { q: 'hello', limit: 20 });

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            deletedAt: null,
            body: { contains: 'hello', mode: 'insensitive' },
            channel: { members: { some: { userId: 'u1' } } },
          }),
        }),
      );
      expect(results[0].channelName).toBe('general');
    });
  });

  describe('toDto (reactions)', () => {
    it('groups reactions by emoji with the count and ids of everyone who reacted', async () => {
      prisma.message.findUnique.mockResolvedValue(
        baseMessage({
          reactions: [
            { emoji: '👍', userId: 'u2', createdAt: new Date('2026-01-01T00:00:01Z') },
            { emoji: '👍', userId: 'u1', createdAt: new Date('2026-01-01T00:00:02Z') },
            { emoji: '🔥', userId: 'u3', createdAt: new Date('2026-01-01T00:00:03Z') },
          ],
        }),
      );

      const result = await service.send('t1', 'u1', {
        clientMsgId: 'c1',
        channelId: 'ch1',
        body: 'hello',
        mentionedUserIds: [],
        attachmentIds: [],
      });

      expect(result.reactions).toEqual([
        { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u2', 'u1'] },
        { emoji: '🔥', count: 1, reactedByMe: false, userIds: ['u3'] },
      ]);
    });
  });

  describe('listReceipts', () => {
    it('returns every member\'s current read position for the channel', async () => {
      prisma.readReceipt.findMany.mockResolvedValue([
        { userId: 'u2', seq: 7n, updatedAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const result = await service.listReceipts('t1', 'u1', 'ch1');

      expect(channelsService.assertChannelMember).toHaveBeenCalledWith('t1', 'u1', 'ch1');
      expect(prisma.readReceipt.findMany).toHaveBeenCalledWith({ where: { tenantId: 't1', channelId: 'ch1' } });
      expect(result).toEqual([{ userId: 'u2', seq: 7, updatedAt: '2026-01-01T00:00:00.000Z' }]);
    });
  });

  describe('tenant isolation', () => {
    it('propagates a ForbiddenException when the caller is not a channel member', async () => {
      channelsService.assertChannelMember.mockRejectedValue(new ForbiddenException());

      await expect(
        service.send('t1', 'intruder', {
          clientMsgId: 'c9',
          channelId: 'ch1',
          body: 'x',
          mentionedUserIds: [],
          attachmentIds: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
