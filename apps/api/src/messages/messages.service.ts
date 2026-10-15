import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EditMessageInput,
  ListMessagesQuery,
  MessageDto,
  MessageSearchResultDto,
  ReactionInput,
  ReadReceiptDto,
  SearchMessagesQuery,
  SendMessageInput,
} from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

type MessageWithReactions = {
  id: string;
  tenantId: string;
  channelId: string;
  authorId: string;
  clientMsgId: string;
  seq: bigint;
  body: string;
  parentId: string | null;
  quotedMessageId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  reactions: { emoji: string; userId: string; createdAt: Date }[];
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  mentions?: { userId: string }[];
  quotedMessage?: { id: string; authorId: string; body: string; deletedAt: Date | null } | null;
};

const MESSAGE_INCLUDE = {
  reactions: true,
  attachments: true,
  mentions: true,
  quotedMessage: { select: { id: true, authorId: true, body: true, deletedAt: true } },
} as const;

const PREVIEW_MAX_LENGTH = 140;

/** Plain-text one-liner stored on Channel.lastMessagePreview for the channel list. Falls
 *  back to a marker for an attachment-only message; empty string when there's nothing to
 *  show (which then renders as null once no message survives). */
function toMessagePreview(body: string, hasAttachments: boolean): string {
  const trimmed = body.trim();
  if (trimmed.length > 0) {
    return trimmed.length > PREVIEW_MAX_LENGTH ? `${trimmed.slice(0, PREVIEW_MAX_LENGTH)}…` : trimmed;
  }
  return hasAttachments ? '📎 Attachment' : '';
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelsService: ChannelsService,
  ) {}

  /** Idempotent on (channelId, clientMsgId): a retried send returns the original message. */
  async send(tenantId: string, userId: string, input: SendMessageInput): Promise<MessageDto> {
    await this.channelsService.assertChannelMember(tenantId, userId, input.channelId);
    await this.channelsService.assertNotBanned(tenantId, input.channelId, userId);
    await this.channelsService.assertCanPost(tenantId, userId, input.channelId);

    const existing = await this.prisma.message.findUnique({
      where: { channelId_clientMsgId: { channelId: input.channelId, clientMsgId: input.clientMsgId } },
      include: MESSAGE_INCLUDE,
    });
    if (existing) return this.toDto(existing, userId);

    const created = await this.prisma.$transaction(async (tx) => {
      const channel = await tx.channel.update({
        where: { id: input.channelId },
        data: {
          lastMessageSeq: { increment: 1 },
          lastMessageAt: new Date(),
          lastMessagePreview: toMessagePreview(input.body, input.attachmentIds.length > 0),
        },
      });

      return tx.message.create({
        data: {
          tenantId,
          channelId: input.channelId,
          authorId: userId,
          clientMsgId: input.clientMsgId,
          seq: channel.lastMessageSeq,
          body: input.body,
          parentId: input.parentId,
          quotedMessageId: input.quotedMessageId,
          attachments: input.attachmentIds.length
            ? { connect: input.attachmentIds.map((id) => ({ id })) }
            : undefined,
          mentions: input.mentionedUserIds.length
            ? { create: input.mentionedUserIds.map((mentionedUserId) => ({ userId: mentionedUserId })) }
            : undefined,
        },
        include: MESSAGE_INCLUDE,
      });
    });

    return this.toDto(created, userId);
  }

  async edit(tenantId: string, userId: string, input: EditMessageInput): Promise<MessageDto> {
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, tenantId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.authorId !== userId) throw new ForbiddenException('Cannot edit another user\'s message');

    const updated = await this.prisma.message.update({
      where: { id: input.messageId },
      data: { body: input.body, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
    await this.syncChannelPreviewAfterChange(updated.channelId, updated.seq);
    return this.toDto(updated, userId);
  }

  async softDelete(tenantId: string, userId: string, messageId: string): Promise<MessageDto> {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, tenantId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.authorId !== userId) throw new ForbiddenException('Cannot delete another user\'s message');

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '' },
      include: MESSAGE_INCLUDE,
    });
    await this.syncChannelPreviewAfterChange(updated.channelId, updated.seq);
    return this.toDto(updated, userId);
  }

  /** Moderation override: an ADMIN/OWNER may soft-delete any message in the tenant,
   *  regardless of authorship. The `@Roles(ADMIN)` guard on the controller is the real gate. */
  async adminDelete(tenantId: string, messageId: string): Promise<MessageDto> {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, tenantId } });
    if (!message) throw new NotFoundException('Message not found');

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '' },
      include: MESSAGE_INCLUDE,
    });
    await this.syncChannelPreviewAfterChange(updated.channelId, updated.seq);
    return this.toDto(updated, message.authorId);
  }

  /** Keeps Channel.lastMessagePreview / lastMessageAt correct when the *most recent* message
   *  is edited or deleted. A change to any older message is a no-op. On delete of the latest
   *  message the preview rolls back to the previous surviving one (or null for an emptied
   *  channel); lastMessageSeq itself is left untouched — it's the monotonic cursor, not a
   *  pointer to the visible tail. */
  private async syncChannelPreviewAfterChange(channelId: string, changedSeq: bigint): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { lastMessageSeq: true },
    });
    if (!channel || channel.lastMessageSeq !== changedSeq) return;

    const latest = await this.prisma.message.findFirst({
      where: { channelId, deletedAt: null },
      orderBy: { seq: 'desc' },
      include: { attachments: { select: { id: true } } },
    });
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        lastMessagePreview: latest ? toMessagePreview(latest.body, latest.attachments.length > 0) : null,
        lastMessageAt: latest ? latest.createdAt : null,
      },
    });
  }

  async list(tenantId: string, userId: string, query: ListMessagesQuery): Promise<MessageDto[]> {
    await this.channelsService.assertChannelMember(tenantId, userId, query.channelId);

    const messages = await this.prisma.message.findMany({
      where: {
        tenantId,
        channelId: query.channelId,
        parentId: query.parentId ?? null,
        ...(query.cursor !== undefined ? { seq: { gt: BigInt(query.cursor) } } : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: { seq: 'asc' },
      take: query.limit,
    });

    return messages.map((m) => this.toDto(m, userId));
  }

  /** Used by the realtime gateway to replay missed messages after a reconnect. */
  async listSince(
    tenantId: string,
    userId: string,
    channelId: string,
    lastSeq: number,
  ): Promise<{ messages: MessageDto[]; latestSeq: number }> {
    await this.channelsService.assertChannelMember(tenantId, userId, channelId);
    const messages = await this.prisma.message.findMany({
      where: { tenantId, channelId, seq: { gt: BigInt(lastSeq) } },
      include: MESSAGE_INCLUDE,
      orderBy: { seq: 'asc' },
      take: 500,
    });
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    return {
      messages: messages.map((m) => this.toDto(m, userId)),
      latestSeq: Number(channel.lastMessageSeq),
    };
  }

  async react(tenantId: string, userId: string, input: ReactionInput): Promise<{ added: boolean; channelId: string }> {
    const message = await this.prisma.message.findFirst({ where: { id: input.messageId, tenantId } });
    if (!message) throw new NotFoundException('Message not found');
    await this.channelsService.assertChannelMember(tenantId, userId, message.channelId);

    const existing = await this.prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId: input.messageId, userId, emoji: input.emoji } },
    });
    if (existing) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
      return { added: false, channelId: message.channelId };
    }
    await this.prisma.reaction.create({
      data: { tenantId, messageId: input.messageId, userId, emoji: input.emoji },
    });
    return { added: true, channelId: message.channelId };
  }

  async markRead(tenantId: string, userId: string, channelId: string, seq: number): Promise<void> {
    await this.channelsService.assertChannelMember(tenantId, userId, channelId);
    await this.prisma.readReceipt.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: { seq },
      create: { tenantId, channelId, userId, seq },
    });
  }

  /** Current read state for every member who has read at least one message in the channel —
   *  lets a client render per-message ticks immediately on load instead of only after the next
   *  live `receipt:read` event (which it'd otherwise miss for anything read before it opened). */
  async listReceipts(tenantId: string, userId: string, channelId: string): Promise<ReadReceiptDto[]> {
    await this.channelsService.assertChannelMember(tenantId, userId, channelId);
    const receipts = await this.prisma.readReceipt.findMany({ where: { tenantId, channelId } });
    return receipts.map((r) => ({ userId: r.userId, seq: Number(r.seq), updatedAt: r.updatedAt.toISOString() }));
  }

  /** ILIKE across every channel the caller belongs to in this tenant — a scaling limitation
   *  vs. real full-text search, acceptable for this slice's data volumes. Cursor is the last
   *  seen message id (exclusive), ordered by recency. */
  async search(tenantId: string, userId: string, query: SearchMessagesQuery): Promise<MessageSearchResultDto[]> {
    const cursorMessage = query.cursor
      ? await this.prisma.message.findFirst({ where: { id: query.cursor, tenantId } })
      : null;

    const messages = await this.prisma.message.findMany({
      where: {
        tenantId,
        deletedAt: null,
        body: { contains: query.q, mode: 'insensitive' },
        channel: { members: { some: { userId } } },
        ...(cursorMessage ? { createdAt: { lt: cursorMessage.createdAt } } : {}),
      },
      include: { ...MESSAGE_INCLUDE, channel: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return messages.map((m) => ({ ...this.toDto(m, userId), channelName: m.channel.name }));
  }

  private toDto(message: MessageWithReactions, requestingUserId: string): MessageDto {
    const grouped = new Map<string, { count: number; reactedByMe: boolean; userIds: string[] }>();
    for (const r of [...message.reactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const entry = grouped.get(r.emoji) ?? { count: 0, reactedByMe: false, userIds: [] };
      entry.count += 1;
      entry.userIds.push(r.userId);
      if (r.userId === requestingUserId) entry.reactedByMe = true;
      grouped.set(r.emoji, entry);
    }

    return {
      id: message.id,
      tenantId: message.tenantId,
      channelId: message.channelId,
      authorId: message.authorId,
      clientMsgId: message.clientMsgId,
      seq: Number(message.seq),
      body: message.deletedAt ? '' : message.body,
      parentId: message.parentId,
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
      reactions: Array.from(grouped.entries()).map(([emoji, v]) => ({ emoji, ...v })),
      attachments: message.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
      quoted:
        message.quotedMessage && !message.quotedMessage.deletedAt
          ? {
              id: message.quotedMessage.id,
              authorId: message.quotedMessage.authorId,
              body: message.quotedMessage.body,
            }
          : null,
      mentionedUserIds: message.mentions?.map((m) => m.userId) ?? [],
    };
  }
}
