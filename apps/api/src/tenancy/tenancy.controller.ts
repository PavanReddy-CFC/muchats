import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  TenantMemberDto,
  TenantRole,
  UpdateMemberRoleInput,
  UpdateMemberRoleInputSchema,
} from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { TenancyService } from './tenancy.service';

@ApiTags('tenancy')
@Controller('tenancy')
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get('members')
  listMembers(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
  ): Promise<TenantMemberDto[]> {
    return this.tenancyService.listMembers(user.tenantId, search);
  }

  @Roles(TenantRole.ADMIN)
  @Patch('members/:userId')
  updateRole(
    @CurrentUser() user: RequestUser,
    @Param('userId') targetUserId: string,
    @ZodBody(UpdateMemberRoleInputSchema) body: UpdateMemberRoleInput,
  ): Promise<TenantMemberDto> {
    return this.tenancyService.updateMemberRole(user.tenantId, targetUserId, body.role);
  }
}
