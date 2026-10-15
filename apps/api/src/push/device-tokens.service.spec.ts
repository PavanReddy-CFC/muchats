import { DeviceTokensService } from './device-tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevicePlatform } from '@qennect/shared-types';

function makePrismaMock() {
  return {
    deviceToken: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('DeviceTokensService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: DeviceTokensService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new DeviceTokensService(prisma as unknown as PrismaService);
  });

  it('register upserts on (tenantId, token) so re-registering the same token moves it to the current user', async () => {
    await service.register('t1', 'u1', { token: 'tok-1', platform: DevicePlatform.IOS });

    expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
      where: { tenantId_token: { tenantId: 't1', token: 'tok-1' } },
      update: { userId: 'u1', platform: DevicePlatform.IOS },
      create: { tenantId: 't1', userId: 'u1', token: 'tok-1', platform: DevicePlatform.IOS },
    });
  });

  it('unregister deletes scoped to the tenant', async () => {
    await service.unregister('t1', 'tok-1');
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', token: 'tok-1' } });
  });

  it('listForUsers short-circuits without a query for an empty user list', async () => {
    const result = await service.listForUsers('t1', []);
    expect(result).toEqual([]);
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });

  it('removeStaleTokens short-circuits for an empty token list', async () => {
    await service.removeStaleTokens('t1', []);
    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
  });
});
