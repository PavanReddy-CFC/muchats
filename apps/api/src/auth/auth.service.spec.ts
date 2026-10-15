import { ForbiddenException } from '@nestjs/common';
import { TenantRole } from '@qennect/shared-types';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

function makeService(overrides: {
  membership?: { role: TenantRole; user: { isSuperAdmin: boolean } } | null;
  memberships?: { tenantId: string; role: TenantRole; tenant: { slug: string; name: string } }[];
  tenant?: { id: string; slug: string };
  existingUser?: { id: string; isSuperAdmin: boolean } | null;
  membershipCount?: number;
  configOverrides?: Record<string, string | number | undefined>;
}) {
  const prisma = {
    tenant: {
      upsert: jest.fn().mockResolvedValue(overrides.tenant ?? { id: 'tenant-1', slug: 'demo' }),
    },
    tenantMembership: {
      findUnique: jest.fn().mockResolvedValue(overrides.membership ?? null),
      findMany: jest.fn().mockResolvedValue(overrides.memberships ?? []),
      count: jest.fn().mockResolvedValue(overrides.membershipCount ?? 0),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ ...data, id: 'membership-1', joinedAt: new Date() })),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingUser ?? null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, isSuperAdmin: false })),
    },
    session: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const config = {
    get: (key: string) => {
      const values: Record<string, string | number | undefined> = {
        JWT_REFRESH_TTL_DAYS: 30,
        JWT_ACCESS_TTL: '15m',
        JWT_ACCESS_SECRET: 'test-secret',
        ...overrides.configOverrides,
      };
      return values[key];
    },
  };
  const service = new AuthService(prisma as unknown as PrismaService, jwtService as any, config as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  return { service, prisma, jwtService };
}

describe('AuthService.switchCommunity', () => {
  it('rejects switching to a community the user is not a member of', async () => {
    const { service } = makeService({ membership: null });

    await expect(service.switchCommunity('user-1', 'tenant-not-mine')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('issues fresh tokens scoped to the target community when membership exists', async () => {
    const { service, prisma, jwtService } = makeService({
      membership: { role: TenantRole.MEMBER, user: { isSuperAdmin: false } },
    });

    const tokens = await service.switchCommunity('user-1', 'tenant-2');

    expect(tokens.accessToken).toBe('signed.jwt.token');
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-2', userId: 'user-1' }) }),
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', tenantId: 'tenant-2', role: TenantRole.MEMBER }),
      expect.anything(),
    );
  });
});

describe('AuthService.federatedLogin', () => {
  it('creates the chat user with id set to the supplied Qennect member id, never a fresh uuid', async () => {
    const { service, prisma } = makeService({ existingUser: null, membershipCount: 0 });

    const tokens = await service.federatedLogin({
      tenantSlug: 'demo',
      qennectMemberId: 'qennect-member-1',
      qennectClientId: 'client-1',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'qennect-member-1' } });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'qennect-member-1' }) }),
    );
    // First member of the tenant → OWNER, same rule as the password-based register() path.
    expect(prisma.tenantMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'qennect-member-1', role: TenantRole.OWNER }) }),
    );
    expect(tokens.accessToken).toBe('signed.jwt.token');
  });

  it('reuses the existing chat user by id and does not mint a new one on a repeat login', async () => {
    const { service, prisma } = makeService({
      existingUser: { id: 'qennect-member-1', isSuperAdmin: false },
      membership: { role: TenantRole.MEMBER, user: { isSuperAdmin: false } },
    });

    await service.federatedLogin({
      tenantSlug: 'demo',
      qennectMemberId: 'qennect-member-1',
      qennectClientId: 'client-1',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.listMyCommunities', () => {
  it('returns every community the user belongs to, regardless of the current token tenant', async () => {
    const { service } = makeService({
      memberships: [
        { tenantId: 't1', role: TenantRole.OWNER, tenant: { slug: 'lions-club', name: 'Lions Club' } },
        { tenantId: 't2', role: TenantRole.MEMBER, tenant: { slug: 'salty-dawg', name: 'Salty Dawg' } },
      ],
    });

    const communities = await service.listMyCommunities('user-1');

    expect(communities).toEqual([
      { tenantId: 't1', tenantSlug: 'lions-club', tenantName: 'Lions Club', role: TenantRole.OWNER },
      { tenantId: 't2', tenantSlug: 'salty-dawg', tenantName: 'Salty Dawg', role: TenantRole.MEMBER },
    ]);
  });
});
