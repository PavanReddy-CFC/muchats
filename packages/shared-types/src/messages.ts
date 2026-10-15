import { z } from 'zod';
import { AttachmentDto } from './attachments';

// body may be empty for an image-only message, but a message must have a body or at least
// one attachment — enforced by the .refine below.
export const SendMessageInputSchema = z
  .object({
    clientMsgId: z.string().uuid(),
    channelId: z.string().uuid(),
    body: z.string().max(8000).default(''),
    parentId: z.string().uuid().optional(),
    /// Inline "reply to this one message" — distinct from parentId (a thread reply).
    quotedMessageId: z.string().uuid().optional(),
    /// The composer already knows which members it autocompleted via @-mention. Not `.uuid()`:
    /// a federated user's id is the raw Qennect member id, not a UUID.
    mentionedUserIds: z.array(z.string().min(1)).default([]),
    attachmentIds: z.array(z.string().uuid()).default([]),
  })
  .refine((input) => input.body.trim().length > 0 || input.attachmentIds.length > 0, {
    message: 'Message must have a body or at least one attachment',
  });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const EditMessageInputSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().min(1).max(8000),
});
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;

export const ListMessagesQuerySchema = z.object({
  channelId: z.string().uuid(),
  cursor: z.coerce.number().int().nonnegative().optional(), // seq cursor, exclusive
  limit: z.coerce.number().int().min(1).max(100).default(50),
  parentId: z.string().uuid().optional(), // thread replies
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export interface MessageDto {
  id: string;
  tenantId: string;
  channelId: string;
  authorId: string;
  clientMsgId: string;
  seq: number;
  body: string;
  parentId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: ReactionSummary[];
  attachments: AttachmentDto[];
  /// Resolved preview so the client never needs a second fetch to render a quoted reply.
  quoted: QuotedMessagePreview | null;
  mentionedUserIds: string[];
}

export interface QuotedMessagePreview {
  id: string;
  authorId: string;
  body: string;
}

export const SearchMessagesQuerySchema = z.object({
  q: z.string().min(1).max(200),
  cursor: z.string().uuid().optional(), // last seen message id, exclusive
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchMessagesQuery = z.infer<typeof SearchMessagesQuerySchema>;

export interface MessageSearchResultDto extends MessageDto {
  channelName: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /// Ids of every user who reacted with this emoji, in the order they reacted.
  userIds: string[];
}

export const ReactionInputSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(16),
});
export type ReactionInput = z.infer<typeof ReactionInputSchema>;

export const ReadReceiptInputSchema = z.object({
  channelId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
});
export type ReadReceiptInput = z.infer<typeof ReadReceiptInputSchema>;

export const ListReadReceiptsQuerySchema = z.object({
  channelId: z.string().uuid(),
});
export type ListReadReceiptsQuery = z.infer<typeof ListReadReceiptsQuerySchema>;

/// One row per channel member: the highest message `seq` they've read, so a client can
/// render per-message ticks immediately on load rather than waiting for a live receipt event.
export interface ReadReceiptDto {
  userId: string;
  seq: number;
  updatedAt: string;
}
