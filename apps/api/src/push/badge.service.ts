import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BadgeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Total unread messages across every non-muted channel the user belongs to — this is what
   *  gets sent as the push payload's badge count (apns.payload.aps.badge on iOS, which the OS
   *  applies to the app icon automatically; android.notification.notificationCount on
   *  Android, support for which varies by launcher/OEM). Computed from each channel's
   *  lastMessageSeq against the user's ReadReceipt.seq rather than counting message rows, so
   *  it stays cheap regardless of channel history length. A muted channel is deliberately
   *  excluded — consistent with it not triggering a push notification either. */
  async computeUnreadBadge(tenantId: string, userId: string): Promise<number> {
    const memberships = await this.prisma.channelMember.findMany({
      where: { tenantId, userId, muted: false },
      select: { channelId: true },
    });
    if (memberships.length === 0) return 0;
    const channelIds = memberships.map((m) => m.channelId);

    const [channels, receipts] = await Promise.all([
      this.prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, lastMessageSeq: true } }),
      this.prisma.readReceipt.findMany({
        where: { tenantId, userId, channelId: { in: channelIds } },
        select: { channelId: true, seq: true },
      }),
    ]);
    const readByChannel = new Map(receipts.map((r) => [r.channelId, r.seq]));

    let total = 0;
    for (const channel of channels) {
      const read = readByChannel.get(channel.id) ?? 0n;
      const unread = channel.lastMessageSeq - read;
      if (unread > 0n) total += Number(unread);
    }
    return total;
  }
}
