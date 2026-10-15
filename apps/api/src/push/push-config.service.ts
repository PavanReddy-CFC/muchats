import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantPushConfigStatusDto } from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipher } from '../common/crypto/secret-cipher.util';
import { parseServiceAccountJson } from './service-account.util';

/** Admin-facing config for a tenant's own Firebase project (white-label: each tenant sends
 *  push through its own project, there is no shared default). The service-account secret is
 *  encrypted at rest via PUSH_CONFIG_ENCRYPTION_KEY and never decrypted back out through any
 *  endpoint — only FirebaseAppRegistryService's `decryptServiceAccount` reads it, to build a
 *  short-lived in-process Firebase Admin credential. */
@Injectable()
export class PushConfigService {
  private cipher: SecretCipher | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private getCipher(): SecretCipher {
    if (!this.cipher) {
      const key = this.config.get<string>('PUSH_CONFIG_ENCRYPTION_KEY');
      if (!key) {
        throw new InternalServerErrorException(
          'Push notifications are not configured on this server (missing PUSH_CONFIG_ENCRYPTION_KEY)',
        );
      }
      this.cipher = new SecretCipher(key);
    }
    return this.cipher;
  }

  async setConfig(tenantId: string, serviceAccountJson: string): Promise<TenantPushConfigStatusDto> {
    let parsed;
    try {
      parsed = parseServiceAccountJson(serviceAccountJson);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const encryptedServiceAccount = this.getCipher().encrypt(serviceAccountJson);
    const row = await this.prisma.tenantPushConfig.upsert({
      where: { tenantId },
      update: { encryptedServiceAccount, projectId: parsed.project_id },
      create: { tenantId, encryptedServiceAccount, projectId: parsed.project_id },
    });
    return { configured: true, projectId: row.projectId, updatedAt: row.updatedAt.toISOString() };
  }

  async getStatus(tenantId: string): Promise<TenantPushConfigStatusDto> {
    const row = await this.prisma.tenantPushConfig.findUnique({ where: { tenantId } });
    if (!row) return { configured: false, projectId: null, updatedAt: null };
    return { configured: true, projectId: row.projectId, updatedAt: row.updatedAt.toISOString() };
  }

  async clearConfig(tenantId: string): Promise<void> {
    await this.prisma.tenantPushConfig.deleteMany({ where: { tenantId } });
  }

  /** Internal use only (FirebaseAppRegistryService) — decrypts the stored service account back
   *  to the raw JSON string so it can be handed to admin.credential.cert(). */
  decrypt(encryptedServiceAccount: string): string {
    return this.getCipher().decrypt(encryptedServiceAccount);
  }
}
