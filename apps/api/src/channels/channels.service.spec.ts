import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelMemberRole, ChannelPostingPolicy, ChannelType, TenantRole } from '@qennect/shared-types';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

type Membership = { role: ChannelMemberRole; tenantId?: string; muted?: boolean };

type ChannelMemberRow = {
  userId: string;
  tenantId?: string;
  role?: ChannelMemberRole;
  joinedAt?: Date;
  muted?: boolean;
  user?: { email: string; displayName: string };
};

function makePrismaMock(membershipByUserId: Record<string, Membership | undefined> = {}) {
  const members = { ...membershipByUserId };
  const bans: Record<string, string> = {};
  const prisma = {
    channelMember: {
      findUnique: jest.fn(({ where }: { where: { channelId_userId: { userId: string } } }) => {
        const found = members[where.channelId_userId.userId];
        return Promise.resolve(
          found ? { tenantId: 'tenant-A', role: found.role, muted: found.muted ?? false, joinedAt: new Date() } : null,
        );
      }),
      findMany: jest.fn((): Promise<ChannelMemberRow[]> =>
        Promise.resolve(Object.keys(members).map((userId) => ({ userId, tenantId: 'tenant-A' }))),
      ),
      update: jest.fn(({ where, data }: { where: { channelId_userId: { userId: string } }; data: Partial<Membership> }) => {
        const userId = where.channelId_userId.userId;
        members[userId] = { ...(members[userId] ?? { role: ChannelMemberRole.MEMBER }), ...data };
        return Promise.resolve({
          userId,
          role: members[userId]!.role,
          muted: members[userId]!.muted ?? false,
          joinedAt: new Date(),
          user: { email: 'a@b.com', displayName: 'A' },
        });
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    channel: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ch1',
        tenantId: 'tenant-A',
        type: ChannelType.PUBLIC,
        postingPolicy: 'EVERYONE',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({
        id: 'ch1',
        tenantId: 'tenant-A',
        type: ChannelType.PRIVATE,
        name: 'renamed',
        description: null,
        avatarUrl: null,
        postingPolicy: 'EVERYONE',
        createdAt: new Date(),
        lastMessageSeq: 0n,
        lastMessagePreview: null,
        lastMessageAt: null,
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    channelBan: {
      findUnique: jest.fn(({ where }: { where: { channelId_userId: { userId: string } } }) =>
        Promise.resolve(
          bans[where.channelId_userId.userId] ? { tenantId: 'tenant-A', bannedByUserId: bans[where.channelId_userId.userId] } : null,
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(({ where, create }: { where: { channelId_userId: { userId: string } }; create: { bannedByUserId: string } }) => {
        bans[where.channelId_userId.userId] = create.bannedByUserId;
        return Promise.resolve({});
      }),
      delete: jest.fn(({ where }: { where: { channelId_userId: { userId: string } } }) => {
        delete bans[where.channelId_userId.userId];
        return Promise.resolve({});
      }),
      deleteMany: jest.fn(({ where }: { where: { userId: string } }) => {
        delete bans[where.userId];
        return Promise.resolve({ count: 1 });
      }),
    },
    tenantMembership: {
      findMany: jest.fn(({ where }: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(where.userId.in.map((userId) => ({ userId }))),
      ),
      findUnique: jest.fn(({ where }: { where: { tenantId_userId: { userId: string } } }) => {
        const found = members[where.tenantId_userId.userId];
        return Promise.resolve(found ? { role: TenantRole.MEMBER } : { role: TenantRole.MEMBER });
      }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  return prisma;
}

function makeService(membershipByUserId: Record<string, Membership | undefined> = {}) {
  const prisma = makePrismaMock(membershipByUserId);
  const tenancy = { assertMembership: jest.fn() };
  const service = new ChannelsService(prisma as unknown as PrismaService, tenancy as unknown as TenancyService);
  return { service, prisma };
}

describe('ChannelsService (tenant isolation)', () => {
  it('rejects a channel member row that belongs to a different tenant', async () => {
    const { service } = makeService({ u1: { role: ChannelMemberRole.MEMBER } });
    await expect(service.assertChannelMember('tenant-B', 'u1', 'ch1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows access when the membership row matches the requested tenant', async () => {
    const { service } = makeService({ u1: { role: ChannelMemberRole.MEMBER } });
    await expect(service.assertChannelMember('tenant-A', 'u1', 'ch1')).resolves.toBeUndefined();
  });
});

describe('ChannelsService.updateMemberRole (rank matrix)', () => {
  it('allows a tenant ADMIN to change a channel member role without being a channel member themselves', async () => {
    const { service } = makeService({ target: { role: ChannelMemberRole.MEMBER } });
    await expect(
      service.updateMemberRole('tenant-A', 'tenant-admin', TenantRole.ADMIN, 'ch1', 'target', ChannelMemberRole.ADMIN),
    ).resolves.toMatchObject({ role: ChannelMemberRole.ADMIN });
  });

  it('allows a channel ADMIN to promote a member to MODERATOR (below their own rank)', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.MODERATOR),
    ).resolves.toMatchObject({ role: ChannelMemberRole.MODERATOR });
  });

  it('rejects a channel ADMIN granting another ADMIN role (cannot grant at or above own rank)', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a channel ADMIN modifying another ADMIN (target already at own rank)', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.ADMIN },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.MODERATOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows the channel OWNER to grant ADMIN', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.OWNER },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.ADMIN),
    ).resolves.toMatchObject({ role: ChannelMemberRole.ADMIN });
  });

  it('rejects a MODERATOR from changing roles at all (below ADMIN threshold)', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.MODERATOR },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.MODERATOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a plain channel MEMBER (and plain tenant MEMBER) from changing roles', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.MEMBER },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(
      service.updateMemberRole('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target', ChannelMemberRole.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ChannelsService.banMember / unbanMember (rank matrix)', () => {
  it('lets a MODERATOR ban a plain MEMBER', async () => {
    const { service, prisma } = makeService({
      actor: { role: ChannelMemberRole.MODERATOR },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await service.banMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target');
    expect(prisma.channelBan.upsert).toHaveBeenCalled();
    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({ where: { channelId: 'ch1', userId: 'target' } });
  });

  it('rejects a MODERATOR banning an ADMIN (target outranks actor)', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.MODERATOR },
      target: { role: ChannelMemberRole.ADMIN },
    });
    await expect(service.banMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a plain MEMBER from banning anyone', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.MEMBER },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(service.banMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets the OWNER ban an ADMIN', async () => {
    const { service, prisma } = makeService({
      actor: { role: ChannelMemberRole.OWNER },
      target: { role: ChannelMemberRole.ADMIN },
    });
    await service.banMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target');
    expect(prisma.channelBan.upsert).toHaveBeenCalled();
  });

  it('a tenant ADMIN acts with effective OWNER rank and can ban a channel ADMIN', async () => {
    const { service, prisma } = makeService({ target: { role: ChannelMemberRole.ADMIN } });
    await service.banMember('tenant-A', 'tenant-admin', TenantRole.ADMIN, 'ch1', 'target');
    expect(prisma.channelBan.upsert).toHaveBeenCalled();
  });

  it('unban removes the ban row for a MODERATOR-or-above actor', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.MODERATOR } });
    await service.unbanMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target');
    expect(prisma.channelBan.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A', channelId: 'ch1', userId: 'target' },
    });
  });
});

describe('ChannelsService.assertNotBanned', () => {
  it('throws when the user has an active ban in this tenant', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.MODERATOR } });
    await service.banMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target');
    await expect(service.assertNotBanned('tenant-A', 'ch1', 'target')).rejects.toBeInstanceOf(ForbiddenException);
    void prisma;
  });

  it('resolves when there is no ban', async () => {
    const { service } = makeService();
    await expect(service.assertNotBanned('tenant-A', 'ch1', 'nobody')).resolves.toBeUndefined();
  });
});

describe('ChannelsService.removeMember (rank matrix)', () => {
  it('rejects removing a member at or above the actor rank', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.ADMIN },
    });
    await expect(service.removeMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an ADMIN to remove a plain MEMBER', async () => {
    const { service, prisma } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await service.removeMember('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', 'target');
    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A', channelId: 'ch1', userId: 'target' },
    });
  });
});

describe('ChannelsService.deleteChannel', () => {
  it('allows only the exact OWNER rank (not ADMIN)', async () => {
    const { service } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    await expect(service.deleteChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows the channel OWNER to delete', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.OWNER } });
    await service.deleteChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1');
    expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
  });

  it('allows a tenant admin (community overall control) to delete', async () => {
    const { service, prisma } = makeService();
    await service.deleteChannel('tenant-A', 'tenant-admin', TenantRole.OWNER, 'ch1');
    expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
  });
});

describe('ChannelsService.leave (owner guard)', () => {
  it('rejects an OWNER leaving without transferring first', async () => {
    const { service } = makeService({ owner: { role: ChannelMemberRole.OWNER } });
    await expect(service.leave('tenant-A', 'owner', 'ch1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a plain MEMBER to leave', async () => {
    const { service, prisma } = makeService({ member: { role: ChannelMemberRole.MEMBER } });
    await service.leave('tenant-A', 'member', 'ch1');
    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A', channelId: 'ch1', userId: 'member' },
    });
  });
});

describe('ChannelsService.transferOwnership', () => {
  it('promotes the target to OWNER and demotes the actor to ADMIN', async () => {
    const { service, prisma } = makeService({
      owner: { role: ChannelMemberRole.OWNER },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await service.transferOwnership('tenant-A', 'owner', 'ch1', 'target');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects a non-owner attempting to transfer', async () => {
    const { service } = makeService({
      actor: { role: ChannelMemberRole.ADMIN },
      target: { role: ChannelMemberRole.MEMBER },
    });
    await expect(service.transferOwnership('tenant-A', 'actor', 'ch1', 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects transferring to a non-member', async () => {
    const { service } = makeService({ owner: { role: ChannelMemberRole.OWNER } });
    await expect(service.transferOwnership('tenant-A', 'owner', 'ch1', 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ChannelsService.blockInDm / unblockInDm / getDmBlockStatus', () => {
  function makeDmService() {
    const { service, prisma } = makeService({
      me: { role: ChannelMemberRole.OWNER },
      them: { role: ChannelMemberRole.MEMBER },
    });
    prisma.channel.findFirst.mockResolvedValue({ id: 'ch1', tenantId: 'tenant-A', type: ChannelType.DM });
    return { service, prisma };
  }

  it('rejects blocking in a non-DM channel', async () => {
    const { service, prisma } = makeService({ me: { role: ChannelMemberRole.OWNER } });
    prisma.channel.findFirst.mockResolvedValue({ id: 'ch1', tenantId: 'tenant-A', type: ChannelType.PUBLIC });

    await expect(service.blockInDm('tenant-A', 'me', 'ch1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a caller who is not a member of the DM', async () => {
    const { service } = makeDmService();
    await expect(service.blockInDm('tenant-A', 'stranger', 'ch1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets either DM participant block the other with no rank requirement', async () => {
    const { service, prisma } = makeDmService();
    await service.blockInDm('tenant-A', 'me', 'ch1');
    expect(prisma.channelBan.upsert).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: 'ch1', userId: 'them' } },
      update: { bannedByUserId: 'me' },
      create: { tenantId: 'tenant-A', channelId: 'ch1', userId: 'them', bannedByUserId: 'me' },
    });
  });

  it('reports blockedByMe and blockedMe independently for each side', async () => {
    const { service } = makeDmService();
    await service.blockInDm('tenant-A', 'me', 'ch1');

    await expect(service.getDmBlockStatus('tenant-A', 'me', 'ch1')).resolves.toEqual({
      blockedByMe: true,
      blockedMe: false,
    });
    await expect(service.getDmBlockStatus('tenant-A', 'them', 'ch1')).resolves.toEqual({
      blockedByMe: false,
      blockedMe: true,
    });
  });

  it('unblock lifts a block the caller placed', async () => {
    const { service, prisma } = makeDmService();
    await service.blockInDm('tenant-A', 'me', 'ch1');
    await service.unblockInDm('tenant-A', 'me', 'ch1');
    expect(prisma.channelBan.delete).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: 'ch1', userId: 'them' } },
    });
    await expect(service.getDmBlockStatus('tenant-A', 'me', 'ch1')).resolves.toEqual({
      blockedByMe: false,
      blockedMe: false,
    });
  });

  it('unblock is a no-op when the other participant is the one who placed the block', async () => {
    const { service, prisma } = makeDmService();
    await service.blockInDm('tenant-A', 'them', 'ch1'); // them blocks me
    await service.unblockInDm('tenant-A', 'me', 'ch1'); // I cannot lift a block placed on me
    expect(prisma.channelBan.delete).not.toHaveBeenCalled();
    await expect(service.getDmBlockStatus('tenant-A', 'me', 'ch1')).resolves.toEqual({
      blockedByMe: false,
      blockedMe: true,
    });
  });
});

describe('ChannelsService.setMuted', () => {
  it('lets a plain member mute their own channel notifications', async () => {
    const { service, prisma } = makeService({ member: { role: ChannelMemberRole.MEMBER } });
    await service.setMuted('tenant-A', 'member', 'ch1', true);
    expect(prisma.channelMember.update).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: 'ch1', userId: 'member' } },
      data: { muted: true },
    });
  });
});

describe('ChannelsService.updateChannel', () => {
  it('lets a channel ADMIN rename the channel', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    const result = await service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', { name: 'renamed' });
    expect(prisma.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { name: 'renamed' },
    });
    expect(result.name).toBe('renamed');
  });

  it('lets a tenant admin change the channel type (community overall control)', async () => {
    const { service, prisma } = makeService();
    await service.updateChannel('tenant-A', 'tenant-admin', TenantRole.ADMIN, 'ch1', { type: ChannelType.PRIVATE });
    expect(prisma.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { type: ChannelType.PRIVATE },
    });
  });

  it('rejects a plain MEMBER / plain tenant MEMBER', async () => {
    const { service } = makeService({ actor: { role: ChannelMemberRole.MEMBER } });
    await expect(
      service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', { name: 'nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects editing a DM channel', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.OWNER } });
    prisma.channel.findFirst.mockResolvedValueOnce({ id: 'ch1', tenantId: 'tenant-A', type: ChannelType.DM });
    await expect(
      service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', { name: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty patch', async () => {
    const { service } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    await expect(
      service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the channel is missing / in another tenant', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    prisma.channel.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates description / avatarUrl / postingPolicy and clears fields passed as null', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    await service.updateChannel('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', {
      description: 'announcements only',
      avatarUrl: null,
      postingPolicy: ChannelPostingPolicy.ADMINS_ONLY,
    });
    expect(prisma.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: {
        description: 'announcements only',
        avatarUrl: null,
        postingPolicy: ChannelPostingPolicy.ADMINS_ONLY,
      },
    });
  });
});

describe('ChannelsService.addMembers', () => {
  it('adds deduped community members to a group as a channel ADMIN', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    prisma.channelMember.findMany.mockResolvedValueOnce([
      {
        userId: 'u2',
        role: ChannelMemberRole.MEMBER,
        joinedAt: new Date(),
        muted: false,
        user: { email: 'u2@x', displayName: 'U2' },
      },
    ]);

    const result = await service.addMembers('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', ['u2', 'u3', 'u2']);

    expect(prisma.channelMember.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'tenant-A', channelId: 'ch1', userId: 'u2', role: ChannelMemberRole.MEMBER },
        { tenantId: 'tenant-A', channelId: 'ch1', userId: 'u3', role: ChannelMemberRole.MEMBER },
      ],
      skipDuplicates: true,
    });
    expect(result).toHaveLength(1);
  });

  it('rejects a plain MEMBER actor', async () => {
    const { service } = makeService({ actor: { role: ChannelMemberRole.MEMBER } });
    await expect(
      service.addMembers('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', ['u2']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects adding members to a DM', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.OWNER } });
    prisma.channel.findFirst.mockResolvedValueOnce({ id: 'ch1', tenantId: 'tenant-A', type: ChannelType.DM });
    await expect(
      service.addMembers('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', ['u2']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when a target is not a member of the community', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    prisma.tenantMembership.findMany.mockResolvedValueOnce([{ userId: 'u2' }]);
    await expect(
      service.addMembers('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', ['u2', 'u3']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when a target is banned from the channel', async () => {
    const { service, prisma } = makeService({ actor: { role: ChannelMemberRole.ADMIN } });
    prisma.channelBan.findMany.mockResolvedValueOnce([{ userId: 'u2' }]);
    await expect(
      service.addMembers('tenant-A', 'actor', TenantRole.MEMBER, 'ch1', ['u2']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChannelsService.assertCanPost (admin-only posting)', () => {
  it('is a no-op for an EVERYONE channel', async () => {
    const { service } = makeService({ u1: { role: ChannelMemberRole.MEMBER } });
    await expect(service.assertCanPost('tenant-A', 'u1', 'ch1')).resolves.toBeUndefined();
  });

  it('blocks a plain member in an ADMINS_ONLY channel', async () => {
    const { service, prisma } = makeService({ u1: { role: ChannelMemberRole.MEMBER } });
    prisma.channel.findFirst.mockResolvedValueOnce({ postingPolicy: 'ADMINS_ONLY' });
    await expect(service.assertCanPost('tenant-A', 'u1', 'ch1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a channel ADMIN in an ADMINS_ONLY channel', async () => {
    const { service, prisma } = makeService({ u1: { role: ChannelMemberRole.ADMIN } });
    prisma.channel.findFirst.mockResolvedValueOnce({ postingPolicy: 'ADMINS_ONLY' });
    await expect(service.assertCanPost('tenant-A', 'u1', 'ch1')).resolves.toBeUndefined();
  });

  it('allows a tenant community admin in an ADMINS_ONLY channel', async () => {
    const { service, prisma } = makeService();
    prisma.channel.findFirst.mockResolvedValueOnce({ postingPolicy: 'ADMINS_ONLY' });
    prisma.tenantMembership.findUnique.mockResolvedValueOnce({ role: TenantRole.ADMIN });
    await expect(service.assertCanPost('tenant-A', 'tenant-admin', 'ch1')).resolves.toBeUndefined();
  });
});

describe('ChannelsService.listDiscoverable', () => {
  it('queries for PUBLIC channels the caller is neither a member of nor banned from', async () => {
    const { service, prisma } = makeService();
    prisma.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch9',
        tenantId: 'tenant-A',
        type: ChannelType.PUBLIC,
        name: 'general',
        createdAt: new Date(),
        lastMessageSeq: 3n,
        lastMessagePreview: 'hi',
        lastMessageAt: new Date(),
        _count: { members: 12 },
      },
    ]);

    const result = await service.listDiscoverable('tenant-A', 'u1');

    expect(prisma.channel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-A',
          type: ChannelType.PUBLIC,
          members: { none: { userId: 'u1' } },
          bans: { none: { userId: 'u1' } },
        },
      }),
    );
    expect(result[0]).toMatchObject({ id: 'ch9', memberCount: 12, lastMessagePreview: 'hi' });
  });
});
