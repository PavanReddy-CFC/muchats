import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@qennect/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../decorators/current-user.decorator';

const ROLE_RANK: Record<TenantRole, number> = {
  [TenantRole.MEMBER]: 0,
  [TenantRole.ADMIN]: 1,
  [TenantRole.OWNER]: 2,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const minRequired = Math.min(...requiredRoles.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[user.role as TenantRole] < minRequired) {
      throw new ForbiddenException('Insufficient tenant role');
    }
    return true;
  }
}
