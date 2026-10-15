import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantMemberDto, TenantRole } from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws unless the user is a member of the tenant. Call at the top of every
   *  tenant-scoped operation before touching any tenant-owned row. */
  async assertMembership(tenantId: string, userId: string): Promise<void> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this tenant');
    }
  }

  /** search is an optional case-insensitive match against email or displayName — the
   *  chat-eligible member directory used by group-creation/add-member pickers. */
  async listMembers(tenantId: string, search?: string): Promise<TenantMemberDto[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              user: {
                OR: [
                  { email: { contains: search, mode: 'insensitive' } },
                  { displayName: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      role: m.role as unknown as TenantRole,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  /** Ownership transfer is out of scope here: neither the target's current role nor the
   *  requested new role may be OWNER. */
  async updateMemberRole(tenantId: string, targetUserId: string, role: TenantRole): Promise<TenantMemberDto> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: targetUserId } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Member not found');
    if (String(membership.role) === TenantRole.OWNER || role === TenantRole.OWNER) {
      throw new BadRequestException('Cannot change ownership via this endpoint');
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { tenantId_userId: { tenantId, userId: targetUserId } },
      data: { role },
      include: { user: true },
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      displayName: updated.user.displayName,
      role: updated.role as unknown as TenantRole,
      joinedAt: updated.joinedAt.toISOString(),
    };
  }
}
