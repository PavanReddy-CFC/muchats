import { randomBytes } from 'crypto';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PushConfigService } from './push-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const VALID_KEY = randomBytes(32).toString('base64');
const VALID_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'demo-project',
  client_email: 'sa@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});

function makePrismaMock() {
  return { tenantPushConfig: { upsert: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() } };
}

function makeConfigService(key: string | undefined) {
  return { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
}

describe('PushConfigService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
  });

  describe('setConfig', () => {
    it('rejects invalid JSON', async () => {
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(VALID_KEY));
      await expect(service.setConfig('t1', 'not json')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tenantPushConfig.upsert).not.toHaveBeenCalled();
    });

    it('rejects JSON missing required service-account fields', async () => {
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(VALID_KEY));
      await expect(service.setConfig('t1', JSON.stringify({ project_id: 'demo' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when PUSH_CONFIG_ENCRYPTION_KEY is not configured on this server', async () => {
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(undefined));
      await expect(service.setConfig('t1', VALID_SERVICE_ACCOUNT)).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('encrypts the service account and stores it, returning the parsed projectId', async () => {
      prisma.tenantPushConfig.upsert.mockResolvedValue({
        projectId: 'demo-project',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(VALID_KEY));

      const result = await service.setConfig('t1', VALID_SERVICE_ACCOUNT);

      expect(prisma.tenantPushConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1' },
          create: expect.objectContaining({ tenantId: 't1', projectId: 'demo-project' }),
        }),
      );
      // Never stores the plaintext secret directly.
      const call = prisma.tenantPushConfig.upsert.mock.calls[0][0];
      expect(call.create.encryptedServiceAccount).not.toContain('demo-project.iam.gserviceaccount.com');
      expect(result).toEqual({ configured: true, projectId: 'demo-project', updatedAt: '2026-01-01T00:00:00.000Z' });
    });
  });

  describe('getStatus', () => {
    it('reports not configured when no row exists', async () => {
      prisma.tenantPushConfig.findUnique.mockResolvedValue(null);
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(VALID_KEY));

      await expect(service.getStatus('t1')).resolves.toEqual({ configured: false, projectId: null, updatedAt: null });
    });
  });

  describe('decrypt', () => {
    it('round-trips what setConfig encrypted', async () => {
      prisma.tenantPushConfig.upsert.mockResolvedValue({ projectId: 'demo-project', updatedAt: new Date() });
      const service = new PushConfigService(prisma as unknown as PrismaService, makeConfigService(VALID_KEY));

      await service.setConfig('t1', VALID_SERVICE_ACCOUNT);
      const encrypted = prisma.tenantPushConfig.upsert.mock.calls[0][0].create.encryptedServiceAccount;

      expect(service.decrypt(encrypted)).toBe(VALID_SERVICE_ACCOUNT);
    });
  });
});
