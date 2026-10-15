import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { AttachmentDto, AttachmentViewUrl, RequestUploadInput, RequestUploadResult } from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const VIEW_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class AttachmentsService {
  private client: S3Client | null = null;
  private bucket: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly channelsService: ChannelsService,
  ) {}

  private getClient(): { client: S3Client; bucket: string } {
    const bucket = this.config.get<string>('S3_BUCKET');
    const region = this.config.get<string>('S3_REGION');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'Image uploads are not configured on this server (missing S3_* environment variables)',
      );
    }

    if (!this.client) {
      this.client = new S3Client({
        region,
        endpoint,
        forcePathStyle: !!endpoint, // required for R2 / most non-AWS S3-compatible endpoints
        credentials: { accessKeyId, secretAccessKey },
      });
      this.bucket = bucket;
    }
    return { client: this.client, bucket: this.bucket! };
  }

  async requestUpload(tenantId: string, userId: string, input: RequestUploadInput): Promise<RequestUploadResult> {
    const { client, bucket } = this.getClient();
    const attachmentId = uuid();
    const storageKey = `tenants/${tenantId}/uploads/${attachmentId}/${input.fileName}`;

    await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        tenantId,
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: input.mimeType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    void userId; // not needed for the upload itself; kept in the signature for future audit logging
    return { attachmentId, uploadUrl };
  }

  /** Verifies the requester can actually see this attachment (member of the channel the
   *  owning message belongs to) before handing back a viewable URL. */
  async getViewUrl(tenantId: string, userId: string, attachmentId: string): Promise<AttachmentViewUrl> {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, tenantId },
      include: { message: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.message) {
      await this.channelsService.assertChannelMember(tenantId, userId, attachment.message.channelId);
    }

    const { client, bucket } = this.getClient();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: attachment.storageKey }), {
      expiresIn: VIEW_URL_TTL_SECONDS,
    });
    return { url, expiresInSeconds: VIEW_URL_TTL_SECONDS };
  }

  toDto(attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number }): AttachmentDto {
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    };
  }
}
