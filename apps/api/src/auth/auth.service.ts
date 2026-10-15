import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { v4 as uuid } from 'uuid';
import {
  AuthTokens,
  CommunityMembershipDto,
  FederatedLoginInput,
  JwtAccessTokenClaims,
  LoginInput,
  MeDto,
  RegisterInput,
  TenantRole,
} from '@qennect/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterInput): Promise<AuthTokens> {
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: input.tenantSlug },
      update: {},
      create: { slug: input.tenantSlug, name: input.tenantSlug },
    });

    const existingMembership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, user: { email: input.email } },
    });
    if (existingMembership) {
      throw new ConflictException('User already registered in this tenant');
    }

    const passwordHash = await argon2.hash(input.password);
    const isFirstMember = (await this.prisma.tenantMembership.count({
      where: { tenantId: tenant.id },
    })) === 0;

    let user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: input.email, passwordHash, displayName: input.displayName },
      });
    }

    const membership = await this.prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: isFirstMember ? TenantRole.OWNER : TenantRole.MEMBER,
      },
    });

    return this.issueTokens(tenant.id, user.id, membership.role, user.isSuperAdmin);
  }

  /** Federated login: trusts Qennect's own auth instead of a second, muchats-invented
   *  password. The calling app has already authenticated the member against Qennect and
   *  sends `qennectMemberId`/`qennectClientId` directly — muchats does not verify these
   *  against qennect-be (there is no token-introspection call), so the caller's claim is
   *  trusted as-is. Finds-or-creates the chat user **using the supplied member id directly as
   *  `User.id`** — never a separately-minted uuid — so a chat user id is always identical to
   *  the Qennect member id it belongs to, everywhere in the API (channel members, message
   *  `authorId`, etc). Same model as Stream Chat: the calling app supplies its own external
   *  user id and the chat backend uses it as-is. */
  async federatedLogin(input: FederatedLoginInput): Promise<AuthTokens> {
    const memberId = input.qennectMemberId;

    const tenant = await this.prisma.tenant.upsert({
      where: { slug: input.tenantSlug },
      update: {},
      create: { slug: input.tenantSlug, name: input.tenantSlug },
    });

    // Find-or-create by id, not by email — id (the Qennect member id) is the durable
    // identity here. `passwordHash` stays null: a federated user never has a muchats password.
    let user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { id: memberId, email: `${memberId}@qennect.member`, displayName: memberId },
      });
    }

    let membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    });
    if (!membership) {
      const isFirstMember = (await this.prisma.tenantMembership.count({
        where: { tenantId: tenant.id },
      })) === 0;
      membership = await this.prisma.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, role: isFirstMember ? TenantRole.OWNER : TenantRole.MEMBER },
      });
    }

    return this.issueTokens(tenant.id, user.id, membership.role, user.isSuperAdmin);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: input.tenantSlug } });
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, user: { email: input.email } },
      include: { user: true },
    });
    if (!membership) throw new UnauthorizedException('Invalid credentials');

    // A federated (Qennect) user has no muchats password to check against — reject rather
    // than pass null into argon2.
    if (!membership.user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await argon2.verify(membership.user.passwordHash, input.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(tenant.id, membership.userId, membership.role, membership.user.isSuperAdmin, input.deviceName);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.prisma.session.findUnique({ where: { refreshToken } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: session.tenantId, userId: session.userId } },
      include: { user: true },
    });
    if (!membership) throw new UnauthorizedException('Membership not found');

    // Rotate: revoke old session, issue a new one.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      session.tenantId,
      session.userId,
      membership.role,
      membership.user.isSuperAdmin,
      session.deviceName ?? undefined,
    );
  }

  async logoutAllDevices(tenantId: string, userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(tenantId: string, userId: string): Promise<MeDto> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true, tenant: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    return {
      userId,
      tenantId,
      tenantSlug: membership.tenant.slug,
      role: membership.role,
      email: membership.user.email,
      displayName: membership.user.displayName,
      isSuperAdmin: membership.user.isSuperAdmin,
    };
  }

  /** Every community (tenant) this user belongs to — same userId across all of them, since
   *  User.email is global rather than tenant-scoped. Backs the community switcher. */
  async listMyCommunities(userId: string): Promise<CommunityMembershipDto[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId },
      include: { tenant: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      role: m.role,
    }));
  }

  /** Exchanges the caller's current session for one scoped to a different community they're
   *  already a member of — no password re-entry. This is "switch based on the id provided in
   *  the API": the client just passes the target tenantId, proven by TenantMembership, not by
   *  anything the client could forge. Sending messages works immediately afterward because the
   *  new access token carries the new tenantId, same as any fresh login would. */
  async switchCommunity(userId: string, targetTenantId: string, deviceName?: string): Promise<AuthTokens> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: targetTenantId, userId } },
      include: { user: true },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of that community');
    }
    return this.issueTokens(targetTenantId, userId, membership.role, membership.user.isSuperAdmin, deviceName);
  }

  async logoutSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    tenantId: string,
    userId: string,
    role: string,
    isSuperAdmin: boolean,
    deviceName?: string,
  ): Promise<AuthTokens> {
    const sessionId = uuid();
    const refreshToken = uuid() + uuid();
    const refreshTtlDays = this.config.get<number>('JWT_REFRESH_TTL_DAYS')!;
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        tenantId,
        userId,
        deviceName,
        refreshToken,
        expiresAt,
      },
    });

    const claims: JwtAccessTokenClaims = { sub: userId, tenantId, sessionId, role, isSuperAdmin };
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL')!;
    const accessToken = await this.jwtService.signAsync(claims, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ttlToSeconds(accessTtl),
    };
  }

  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
    return value * multiplier;
  }
}
