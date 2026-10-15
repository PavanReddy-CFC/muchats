import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockGetSignedUrl = jest.fn().mockResolvedValue('https://s3.example.com/signed-url');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] };
}

describe('AttachmentsService', () => {
  beforeEach(() => {
    mockGetSignedUrl.mockClear();
  });

  it('throws a clear error instead of touching S3 when storage is not configured', async () => {
    const prisma = { attachment: { create: jest.fn() } };
    const config = makeConfig({}); // no S3_* vars set
    const channelsService = { assertChannelMember: jest.fn() };
    const service = new AttachmentsService(
      prisma as unknown as PrismaService,
      config as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      channelsService as unknown as ChannelsService,
    );

    await expect(
      service.requestUpload('tenant-A', 'user-1', { fileName: 'a.png', mimeType: 'image/png', sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('creates a pending Attachment row and returns a presigned PUT URL when configured', async () => {
    const prisma = { attachment: { create: jest.fn().mockResolvedValue({}) } };
    const config = makeConfig({
      S3_BUCKET: 'bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    const channelsService = { assertChannelMember: jest.fn() };
    const service = new AttachmentsService(
      prisma as unknown as PrismaService,
      config as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      channelsService as unknown as ChannelsService,
    );

    const result = await service.requestUpload('tenant-A', 'user-1', {
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });

    expect(result.uploadUrl).toBe('https://s3.example.com/signed-url');
    expect(prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-A', fileName: 'photo.jpg', mimeType: 'image/jpeg' }),
      }),
    );
  });

  it('rejects a view-url request for an attachment that does not exist in this tenant', async () => {
    const prisma = { attachment: { findFirst: jest.fn().mockResolvedValue(null) } };
    const config = makeConfig({
      S3_BUCKET: 'bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    const channelsService = { assertChannelMember: jest.fn() };
    const service = new AttachmentsService(
      prisma as unknown as PrismaService,
      config as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      channelsService as unknown as ChannelsService,
    );

    await expect(service.getViewUrl('tenant-A', 'user-1', 'missing-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the viewing user is a member of the attachment message channel before signing a GET url', async () => {
    const prisma = {
      attachment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'att-1',
          storageKey: 'tenants/tenant-A/uploads/att-1/photo.jpg',
          message: { channelId: 'ch1' },
        }),
      },
    };
    const config = makeConfig({
      S3_BUCKET: 'bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    const channelsService = { assertChannelMember: jest.fn().mockResolvedValue(undefined) };
    const service = new AttachmentsService(
      prisma as unknown as PrismaService,
      config as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      channelsService as unknown as ChannelsService,
    );

    const result = await service.getViewUrl('tenant-A', 'user-1', 'att-1');

    expect(channelsService.assertChannelMember).toHaveBeenCalledWith('tenant-A', 'user-1', 'ch1');
    expect(result.url).toBe('https://s3.example.com/signed-url');
  });
});
