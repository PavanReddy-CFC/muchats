import { BadgeService } from './badge.service';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    channelMember: { findMany: jest.fn() },
    channel: { findMany: jest.fn() },
    readReceipt: { findMany: jest.fn() },
  };
}

describe('BadgeService.computeUnreadBadge', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: BadgeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new BadgeService(prisma as unknown as PrismaService);
  });

  it('returns 0 with no channel memberships', async () => {
    prisma.channelMember.findMany.mockResolvedValue([]);

    const result = await service.computeUnreadBadge('t1', 'u1');

    expect(result).toBe(0);
    expect(prisma.channel.findMany).not.toHaveBeenCalled();
  });

  it('excludes muted channels from the membership query entirely', async () => {
    prisma.channelMember.findMany.mockResolvedValue([]);
    await service.computeUnreadBadge('t1', 'u1');

    expect(prisma.channelMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', userId: 'u1', muted: false } }),
    );
  });

  it('sums unread messages (lastMessageSeq - read seq) across channels, treating an unread channel as fully unread', async () => {
    prisma.channelMember.findMany.mockResolvedValue([{ channelId: 'ch1' }, { channelId: 'ch2' }]);
    prisma.channel.findMany.mockResolvedValue([
      { id: 'ch1', lastMessageSeq: 10n },
      { id: 'ch2', lastMessageSeq: 3n },
    ]);
    prisma.readReceipt.findMany.mockResolvedValue([{ channelId: 'ch1', seq: 7n }]); // ch2 never read

    const result = await service.computeUnreadBadge('t1', 'u1');

    // ch1: 10 - 7 = 3 unread; ch2: 3 - 0 = 3 unread
    expect(result).toBe(6);
  });

  it('never goes negative for a channel whose read seq is somehow ahead (defensive)', async () => {
    prisma.channelMember.findMany.mockResolvedValue([{ channelId: 'ch1' }]);
    prisma.channel.findMany.mockResolvedValue([{ id: 'ch1', lastMessageSeq: 5n }]);
    prisma.readReceipt.findMany.mockResolvedValue([{ channelId: 'ch1', seq: 9n }]);

    const result = await service.computeUnreadBadge('t1', 'u1');

    expect(result).toBe(0);
  });
});
