import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChannelDto,
  ChannelMemberDto,
  ChannelPostingPolicy,
  ChannelType,
  CreateChannelInput,
  ChannelMemberRole,
  DmBlockStatusDto,
  TenantRole,
  UpdateChannelInput,
} from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

const TENANT_ADMIN_ROLES: TenantRole[] = [TenantRole.ADMIN, TenantRole.OWNER];

/** Owner > Admin > Moderator > Member. A tenant (community) admin acts with effective rank
 *  OWNER for any channel — the existing "community admin overall control" behavior. */
const RANK: Record<ChannelMemberRole, number> = {
  [ChannelMemberRole.MEMBER]: 0,
  [ChannelMemberRole.MODERATOR]: 1,
  [ChannelMemberRole.ADMIN]: 2,
  [ChannelMemberRole.OWNER]: 3,
};
const TENANT_ADMIN_EFFECTIVE_RANK = RANK[ChannelMemberRole.OWNER];
const NOT_A_MEMBER_RANK = -1;

/** Channel-list ordering: most recent activity first, channels with no messages yet
 *  (null lastMessageAt) last, then newest-created among themselves. */
function recentActivityOrder() {
  return [
    { lastMessageAt: { sort: 'desc' as const, nulls: 'last' as const } },
    { createdAt: 'desc' as const },
  ];
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  async create(tenantId: string, userId: string, input: CreateChannelInput): Promise<ChannelDto> {
    await this.tenancy.assertMembership(tenantId, userId);

    const isDm = input.type === ChannelType.DM;
    if (isDm) {
      const otherUserId = input.memberUserIds[0];
      if (!otherUserId) throw new ForbiddenException('DM requires exactly one other member');
      const existing = await this.findExistingDm(tenantId, userId, otherUserId);
      if (existing) return this.toDto(existing);
    }

    const channel = await this.prisma.channel.create({
      data: {
        tenantId,
        type: input.type,
        name: isDm ? null : input.name,
        description: isDm ? null : input.description ?? null,
        avatarUrl: isDm ? null : input.avatarUrl ?? null,
        postingPolicy: isDm ? ChannelPostingPolicy.EVERYONE : input.postingPolicy ?? ChannelPostingPolicy.EVERYONE,
        members: {
          create: [
            { tenantId, userId, role: ChannelMemberRole.OWNER },
            ...input.memberUserIds
              .filter((id) => id !== userId)
              .map((id) => ({ tenantId, userId: id, role: ChannelMemberRole.MEMBER })),
          ],
        },
      },
    });

    return this.toDto(channel);
  }

  /** Edit a group channel's settings — name, type (PUBLIC<->PRIVATE), description, avatar,
   *  posting policy. Requires channel ADMIN rank or higher — a tenant (community) admin
   *  qualifies via the "overall control" shortcut, same threshold as updateMemberRole. A DM
   *  has no editable settings (fixed name-less, 2-person shape), so editing one is rejected.
   *  `description` / `avatarUrl` may be passed as null to clear them. */
  async updateChannel(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    input: UpdateChannelInput,
  ): Promise<ChannelDto> {
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.postingPolicy !== undefined ? { postingPolicy: input.postingPolicy } : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type === ChannelType.DM) {
      throw new BadRequestException('A direct message has no editable settings');
    }

    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.ADMIN]) {
      throw new ForbiddenException('Requires channel admin access or higher');
    }

    const updated = await this.prisma.channel.update({ where: { id: channelId }, data });
    return this.toDto(updated);
  }

  /** Add existing community members to a group channel after creation. Requires channel
   *  ADMIN rank or higher (same threshold as removeMember). Rejects DMs, users who aren't
   *  members of this community, and users currently banned from the channel. Already-members
   *  are silently skipped. Returns the channel's full member list afterwards. */
  async addMembers(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    userIds: string[],
  ): Promise<ChannelMemberDto[]> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type === ChannelType.DM) {
      throw new BadRequestException('Cannot add members to a direct message');
    }

    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.ADMIN]) {
      throw new ForbiddenException('Requires channel admin access or higher');
    }

    const targetIds = [...new Set(userIds)];

    const communityMembers = await this.prisma.tenantMembership.findMany({
      where: { tenantId, userId: { in: targetIds } },
      select: { userId: true },
    });
    if (communityMembers.length !== targetIds.length) {
      throw new BadRequestException('One or more users are not members of this community');
    }

    const banned = await this.prisma.channelBan.findMany({
      where: { channelId, userId: { in: targetIds } },
      select: { userId: true },
    });
    if (banned.length > 0) {
      throw new BadRequestException('One or more users are banned from this channel — unban them first');
    }

    await this.prisma.channelMember.createMany({
      data: targetIds.map((userId) => ({ tenantId, channelId, userId, role: ChannelMemberRole.MEMBER })),
      skipDuplicates: true,
    });

    return this.listMembers(tenantId, channelId);
  }

  /** Enforces a channel's posting policy. A no-op for EVERYONE channels; for ADMINS_ONLY the
   *  caller must be channel ADMIN/OWNER or a tenant community admin. Called from
   *  MessagesService.send alongside assertChannelMember / assertNotBanned. */
  async assertCanPost(tenantId: string, userId: string, channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, tenantId },
      select: { postingPolicy: true },
    });
    if (!channel || channel.postingPolicy !== ChannelPostingPolicy.ADMINS_ONLY) return;

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { role: true },
    });
    const tenantRole = (membership?.role as TenantRole | undefined) ?? TenantRole.MEMBER;
    const rank = await this.getEffectiveRank(tenantId, channelId, userId, tenantRole);
    if (rank < RANK[ChannelMemberRole.ADMIN]) {
      throw new ForbiddenException('Only channel admins can post in this channel');
    }
  }

  /** Admin-only: every channel in the tenant, regardless of the caller's membership. */
  async listAllForTenant(tenantId: string): Promise<ChannelDto[]> {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId },
      orderBy: recentActivityOrder(),
      include: { _count: { select: { members: true } } },
    });
    return channels.map((c) => this.toDto(c, c._count.members));
  }

  /** Sorted by activity: most recent message first (DM or group), falling back to
   *  createdAt for a channel nobody has messaged in yet — see Channel.lastMessageAt. */
  async listForUser(tenantId: string, userId: string): Promise<ChannelDto[]> {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId, members: { some: { userId } } },
      orderBy: recentActivityOrder(),
    });
    return channels.map((c) => this.toDto(c));
  }

  /** Channels a member can discover and self-join: PUBLIC, in their tenant, that they are
   *  neither a member of nor banned from. Ordered by size (busiest communities first) so the
   *  list reads as a directory. The join itself goes through `join()` / POST /channels/:id/join,
   *  which re-checks type and ban state. */
  async listDiscoverable(tenantId: string, userId: string): Promise<ChannelDto[]> {
    await this.tenancy.assertMembership(tenantId, userId);

    const channels = await this.prisma.channel.findMany({
      where: {
        tenantId,
        type: ChannelType.PUBLIC,
        members: { none: { userId } },
        bans: { none: { userId } },
      },
      orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
      include: { _count: { select: { members: true } } },
    });
    return channels.map((c) => this.toDto(c, c._count.members));
  }

  async join(tenantId: string, userId: string, channelId: string): Promise<void> {
    await this.tenancy.assertMembership(tenantId, userId);
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type === ChannelType.PRIVATE || channel.type === ChannelType.DM) {
      throw new ForbiddenException('Cannot self-join a private channel or DM');
    }
    await this.assertNotBanned(tenantId, channelId, userId);
    await this.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: {},
      create: { tenantId, channelId, userId, role: ChannelMemberRole.MEMBER },
    });
  }

  /** An owner must transfer ownership before leaving — there's always exactly one owner. */
  async leave(tenantId: string, userId: string, channelId: string): Promise<void> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (membership && String(membership.role) === ChannelMemberRole.OWNER) {
      throw new BadRequestException('Transfer ownership before leaving this channel');
    }
    await this.prisma.channelMember.deleteMany({ where: { tenantId, channelId, userId } });
  }

  /** Throws unless the user belongs to the channel within this tenant. */
  async assertChannelMember(tenantId: string, userId: string, channelId: string): Promise<void> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!membership || membership.tenantId !== tenantId) {
      throw new ForbiddenException('Not a member of this channel');
    }
  }

  /** Checked alongside assertChannelMember before sending — a ban blocks messaging without
   *  necessarily removing DM membership (see ChannelBan's doc comment in schema.prisma). */
  async assertNotBanned(tenantId: string, channelId: string, userId: string): Promise<void> {
    const ban = await this.prisma.channelBan.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (ban && ban.tenantId === tenantId) {
      throw new ForbiddenException("You've been removed from this conversation");
    }
  }

  async listMembers(tenantId: string, channelId: string): Promise<ChannelMemberDto[]> {
    const members = await this.prisma.channelMember.findMany({
      where: { tenantId, channelId },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => this.toMemberDto(m));
  }

  /** Group admin, promoted per-channel, OR a tenant (community) admin acting with "overall
   *  control" — either is authorized to change a channel member's role, subject to the rank
   *  matrix: actor must outrank both the target's current role and the role being granted.
   *  Ownership transfer is out of scope here — see transferOwnership. */
  async updateMemberRole(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    targetUserId: string,
    role: ChannelMemberRole,
  ): Promise<ChannelMemberDto> {
    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.ADMIN]) {
      throw new ForbiddenException('Requires channel admin access or higher');
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');

    const targetCurrentRank = RANK[membership.role as unknown as ChannelMemberRole];
    const newRoleRank = RANK[role];
    if (targetCurrentRank >= actorRank || newRoleRank >= actorRank) {
      throw new BadRequestException('Cannot grant or modify a role at or above your own — use transfer-ownership for OWNER');
    }

    const updated = await this.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      data: { role },
      include: { user: true },
    });
    return this.toMemberDto(updated);
  }

  /** Plain removal (no ban record — they can rejoin a public channel later). Same rank
   *  threshold as adding a member. */
  async removeMember(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    targetUserId: string,
  ): Promise<void> {
    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.ADMIN]) {
      throw new ForbiddenException('Requires channel admin access or higher');
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });
    if (membership && RANK[membership.role as unknown as ChannelMemberRole] >= actorRank) {
      throw new ForbiddenException('Cannot remove a member at or above your own rank');
    }
    await this.prisma.channelMember.deleteMany({ where: { tenantId, channelId, userId: targetUserId } });
  }

  /** Banning a group member also kicks them (deletes their ChannelMember row); banning in a
   *  DM ("block") leaves the fixed 2-person membership alone — the ban row alone blocks
   *  sending from that point on, checked via assertNotBanned. */
  async banMember(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    targetUserId: string,
  ): Promise<void> {
    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.MODERATOR]) {
      throw new ForbiddenException('Requires channel moderator access or higher');
    }

    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');

    const targetMembership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });
    const targetRank = targetMembership
      ? RANK[targetMembership.role as unknown as ChannelMemberRole]
      : RANK[ChannelMemberRole.MEMBER];
    if (targetRank >= actorRank) {
      throw new ForbiddenException('Cannot ban a member at or above your own rank');
    }

    await this.prisma.channelBan.upsert({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      update: {},
      create: { tenantId, channelId, userId: targetUserId, bannedByUserId: actorUserId },
    });
    if (channel.type !== ChannelType.DM) {
      await this.prisma.channelMember.deleteMany({ where: { channelId, userId: targetUserId } });
    }
  }

  async unbanMember(
    tenantId: string,
    actorUserId: string,
    actorTenantRole: TenantRole,
    channelId: string,
    targetUserId: string,
  ): Promise<void> {
    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank < RANK[ChannelMemberRole.MODERATOR]) {
      throw new ForbiddenException('Requires channel moderator access or higher');
    }
    await this.prisma.channelBan.deleteMany({ where: { tenantId, channelId, userId: targetUserId } });
  }

  /** Per-user, per-channel, independent of role — a member always mutes their own
   *  notifications, no elevated access needed. */
  async setMuted(tenantId: string, userId: string, channelId: string, muted: boolean): Promise<void> {
    await this.assertChannelMember(tenantId, userId, channelId);
    await this.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId } },
      data: { muted },
    });
  }

  /** Self-service block, unlike banMember/unbanMember which require moderator+ rank — either
   *  side of a DM can block the other with no special role. Blocking upserts a ChannelBan row
   *  for the *other* participant, which assertNotBanned then rejects their sends on (see the
   *  ChannelBan doc comment in schema.prisma for why this reuses the same ban mechanism). */
  async blockInDm(tenantId: string, actorUserId: string, channelId: string): Promise<void> {
    const otherUserId = await this.requireDmOtherMember(tenantId, actorUserId, channelId);
    await this.prisma.channelBan.upsert({
      where: { channelId_userId: { channelId, userId: otherUserId } },
      update: { bannedByUserId: actorUserId },
      create: { tenantId, channelId, userId: otherUserId, bannedByUserId: actorUserId },
    });
  }

  /** Only lifts a block *you* placed — if the other participant blocked you instead, this is a
   *  no-op, since unbanMember's moderator-rank path doesn't apply here and self-service unblock
   *  shouldn't let someone lift a block placed on them. */
  async unblockInDm(tenantId: string, actorUserId: string, channelId: string): Promise<void> {
    const otherUserId = await this.requireDmOtherMember(tenantId, actorUserId, channelId);
    const ban = await this.prisma.channelBan.findUnique({
      where: { channelId_userId: { channelId, userId: otherUserId } },
    });
    if (!ban || ban.bannedByUserId !== actorUserId) return;
    await this.prisma.channelBan.delete({ where: { channelId_userId: { channelId, userId: otherUserId } } });
  }

  async getDmBlockStatus(tenantId: string, actorUserId: string, channelId: string): Promise<DmBlockStatusDto> {
    const otherUserId = await this.requireDmOtherMember(tenantId, actorUserId, channelId);
    const [blockedByMe, blockedMe] = await Promise.all([
      this.prisma.channelBan.findUnique({ where: { channelId_userId: { channelId, userId: otherUserId } } }),
      this.prisma.channelBan.findUnique({ where: { channelId_userId: { channelId, userId: actorUserId } } }),
    ]);
    return { blockedByMe: !!blockedByMe, blockedMe: !!blockedMe };
  }

  /** Resolves the other participant in a 1:1 DM, after checking the channel is actually a DM
   *  and the caller belongs to it. Blocking a group makes no sense — that's what ban/kick are
   *  for — so this deliberately rejects anything but ChannelType.DM. */
  private async requireDmOtherMember(tenantId: string, userId: string, channelId: string): Promise<string> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== ChannelType.DM) throw new BadRequestException('Blocking is only available in direct messages');

    const members = await this.prisma.channelMember.findMany({ where: { channelId, tenantId } });
    if (!members.some((m) => m.userId === userId)) throw new ForbiddenException('Not a member of this channel');
    const other = members.find((m) => m.userId !== userId);
    if (!other) throw new NotFoundException('Other participant not found');
    return other.userId;
  }

  /** Only the channel's actual current OWNER may transfer — deliberately not extended to the
   *  tenant-admin "overall control" shortcut, since reassigning ownership is a bigger action
   *  than the moderation-style actions that shortcut otherwise covers. */
  async transferOwnership(tenantId: string, actorUserId: string, channelId: string, targetUserId: string): Promise<void> {
    const actorMembership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: actorUserId } },
    });
    if (!actorMembership || actorMembership.tenantId !== tenantId || String(actorMembership.role) !== ChannelMemberRole.OWNER) {
      throw new ForbiddenException('Only the current channel owner can transfer ownership');
    }
    const targetMembership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });
    if (!targetMembership || targetMembership.tenantId !== tenantId) {
      throw new NotFoundException('Target user is not a member of this channel');
    }

    await this.prisma.$transaction([
      this.prisma.channelMember.update({
        where: { channelId_userId: { channelId, userId: actorUserId } },
        data: { role: ChannelMemberRole.ADMIN },
      }),
      this.prisma.channelMember.update({
        where: { channelId_userId: { channelId, userId: targetUserId } },
        data: { role: ChannelMemberRole.OWNER },
      }),
    ]);
  }

  /** Community admin "overall control": a tenant ADMIN/OWNER may delete any channel, in
   *  addition to a channel's own OWNER. */
  async deleteChannel(tenantId: string, actorUserId: string, actorTenantRole: TenantRole, channelId: string): Promise<void> {
    const actorRank = await this.getEffectiveRank(tenantId, channelId, actorUserId, actorTenantRole);
    if (actorRank !== RANK[ChannelMemberRole.OWNER]) {
      throw new ForbiddenException('Only the channel owner or a community admin can delete this channel');
    }
    await this.prisma.channel.delete({ where: { id: channelId } });
  }

  /** A tenant ADMIN/OWNER acts with effective rank OWNER for any channel in their tenant
   *  ("community admin overall control"); otherwise the caller's real per-channel rank, or
   *  NOT_A_MEMBER_RANK if they don't belong to the channel at all (which then naturally fails
   *  every threshold check below it, without needing a separate not-found branch). */
  private async getEffectiveRank(
    tenantId: string,
    channelId: string,
    userId: string,
    actorTenantRole: TenantRole,
  ): Promise<number> {
    if (TENANT_ADMIN_ROLES.includes(actorTenantRole)) return TENANT_ADMIN_EFFECTIVE_RANK;

    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!membership || membership.tenantId !== tenantId) return NOT_A_MEMBER_RANK;
    return RANK[membership.role as unknown as ChannelMemberRole];
  }

  private async findExistingDm(tenantId: string, userA: string, userB: string) {
    return this.prisma.channel.findFirst({
      where: {
        tenantId,
        type: ChannelType.DM,
        AND: [
          { members: { some: { userId: userA } } },
          { members: { some: { userId: userB } } },
        ],
      },
    });
  }

  private toMemberDto(member: {
    userId: string;
    role: string;
    joinedAt: Date;
    muted: boolean;
    user: { email: string; displayName: string };
  }): ChannelMemberDto {
    return {
      userId: member.userId,
      email: member.user.email,
      displayName: member.user.displayName,
      role: member.role as unknown as ChannelMemberRole,
      joinedAt: member.joinedAt.toISOString(),
      muted: member.muted,
    };
  }

  private toDto(
    channel: {
      id: string;
      tenantId: string;
      type: string;
      name: string | null;
      description: string | null;
      avatarUrl: string | null;
      postingPolicy: string;
      createdAt: Date;
      lastMessageSeq: bigint;
      lastMessagePreview: string | null;
      lastMessageAt: Date | null;
    },
    memberCount?: number,
  ): ChannelDto {
    return {
      id: channel.id,
      tenantId: channel.tenantId,
      type: channel.type as ChannelType,
      name: channel.name,
      description: channel.description,
      avatarUrl: channel.avatarUrl,
      postingPolicy: channel.postingPolicy as ChannelPostingPolicy,
      createdAt: channel.createdAt.toISOString(),
      lastMessageSeq: Number(channel.lastMessageSeq),
      lastMessagePreview: channel.lastMessagePreview,
      lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
      memberCount,
    };
  }
}
