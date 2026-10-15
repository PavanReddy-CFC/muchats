import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_SUPER_ADMIN_KEY } from '../decorators/super-admin.decorator';
import { RequestUser } from '../decorators/current-user.decorator';

/** Platform-level check, deliberately separate from RolesGuard/TenantRole — isSuperAdmin cuts
 *  across tenants and is not part of any tenant's membership. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresSuperAdmin = this.reflector.getAllAndOverride<boolean>(IS_SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiresSuperAdmin) return true;

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Platform superadmin access required');
    }
    return true;
  }
}
