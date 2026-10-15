import { z } from 'zod';
import { ChannelMemberRole, ChannelPostingPolicy, ChannelType } from './enums';

export const CreateChannelInputSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  type: z.nativeEnum(ChannelType),
  /** Group profile — ignored (forced null) for a DM. */
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
  /** Who may post. Defaults to EVERYONE; forced EVERYONE for a DM. */
  postingPolicy: z.nativeEnum(ChannelPostingPolicy).optional(),
  // Not `.uuid()`: a federated user's id is the raw Qennect member id, not a UUID.
  memberUserIds: z.array(z.string().min(1)).default([]),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>;

/** Edit a group channel's settings. Every field is optional; at least one is required.
 *  `type` may move between PUBLIC and PRIVATE but never to/from DM — a DM's shape is fixed
 *  at creation, so the API rejects DM here and the service rejects editing a DM channel.
 *  `description` / `avatarUrl` accept `null` to clear. */
export const UpdateChannelInputSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    type: z
      .nativeEnum(ChannelType)
      .refine((t) => t !== ChannelType.DM, { message: 'type cannot be DM' })
      .optional(),
    description: z.string().max(500).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    postingPolicy: z.nativeEnum(ChannelPostingPolicy).optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.type !== undefined ||
      input.description !== undefined ||
      input.avatarUrl !== undefined ||
      input.postingPolicy !== undefined,
    { message: 'Provide at least one field to update' },
  );
export type UpdateChannelInput = z.infer<typeof UpdateChannelInputSchema>;

/** Add one or more existing community members to a group channel after creation. */
export const AddChannelMembersInputSchema = z.object({
  // Not `.uuid()`: a federated user's id is the raw Qennect member id, not a UUID.
  userIds: z.array(z.string().min(1)).min(1).max(100),
});
export type AddChannelMembersInput = z.infer<typeof AddChannelMembersInputSchema>;

export interface ChannelDto {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  postingPolicy: ChannelPostingPolicy;
  createdAt: string;
  lastMessageSeq: number;
  /** Plain-text summary of the most recent surviving message; null for an empty channel. */
  lastMessagePreview: string | null;
  /** Timestamp of the most recent surviving message; null for an empty channel. Drives the
   *  channel-list ordering (most recent activity first). */
  lastMessageAt: string | null;
  memberCount?: number;
}

export const UpdateChannelMemberRoleInputSchema = z.object({
  role: z.nativeEnum(ChannelMemberRole),
});
export type UpdateChannelMemberRoleInput = z.infer<typeof UpdateChannelMemberRoleInputSchema>;

export interface ChannelMemberDto {
  userId: string;
  email: string;
  displayName: string;
  role: ChannelMemberRole;
  joinedAt: string;
  muted: boolean;
}

export const TransferOwnershipInputSchema = z.object({
  // Not `.uuid()`: a federated user's id is the raw Qennect member id, not a UUID.
  targetUserId: z.string().min(1),
});
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInputSchema>;

export const MuteChannelInputSchema = z.object({
  muted: z.boolean(),
});
export type MuteChannelInput = z.infer<typeof MuteChannelInputSchema>;

/// Blocking is only meaningful in a DM — a group has proper moderation (ban/kick) instead.
export interface DmBlockStatusDto {
  /** I blocked the other participant — they can no longer message me. */
  blockedByMe: boolean;
  /** The other participant blocked me — I can no longer message them. */
  blockedMe: boolean;
}
