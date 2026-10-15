import { SetMetadata } from '@nestjs/common';
import { TenantRole } from '@qennect/shared-types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
