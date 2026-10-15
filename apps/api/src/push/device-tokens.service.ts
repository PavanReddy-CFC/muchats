import { Injectable } from '@nestjs/common';
import { DevicePlatform, RegisterDeviceTokenInput } from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';

export interface DeviceTokenRow {
  userId: string;
  token: string;
  platform: DevicePlatform;
}

/** A device token belongs to whichever user most recently registered it — upserting on the
 *  raw token (not per-user) means a logout/login-as-someone-else on the same device correctly
 *  moves the token to the new user instead of leaving a stale row pointing at the old one. */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async register(tenantId: string, userId: string, input: RegisterDeviceTokenInput): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { tenantId_token: { tenantId, token: input.token } },
      update: { userId, platform: input.platform },
      create: { tenantId, userId, token: input.token, platform: input.platform },
    });
  }

  /** Call on logout / explicit "turn off notifications for this device" so a stale token
   *  doesn't keep receiving push for a user who signed out. */
  async unregister(tenantId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { tenantId, token } });
  }

  async listForUsers(tenantId: string, userIds: string[]): Promise<DeviceTokenRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.deviceToken.findMany({ where: { tenantId, userId: { in: userIds } } });
    return rows.map((r) => ({ userId: r.userId, token: r.token, platform: r.platform as unknown as DevicePlatform }));
  }

  /** Called by PushSenderService when FCM reports a token as unregistered/invalid — pruning
   *  it here means the next send doesn't keep retrying a dead token. */
  async removeStaleTokens(tenantId: string, tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.prisma.deviceToken.deleteMany({ where: { tenantId, token: { in: tokens } } });
  }
}
