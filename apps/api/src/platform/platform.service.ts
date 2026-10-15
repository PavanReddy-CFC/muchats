import { Injectable } from '@nestjs/common';
import { PlatformStatsDto } from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/** Deliberately the one place in the codebase that queries across all tenants — every other
 *  service scopes by tenantId. Isolated here so it's easy to audit; gated by SuperAdminGuard,
 *  never by TenantRole. */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<PlatformStatsDto> {
    const [totalTenants, totalUsers, totalChannels, totalMessages] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.channel.count(),
      this.prisma.message.count(),
    ]);
    return { totalTenants, totalUsers, totalChannels, totalMessages };
  }
}
