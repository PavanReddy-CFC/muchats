import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AddChannelMembersInput,
  AddChannelMembersInputSchema,
  ChannelDto,
  ChannelMemberDto,
  CreateChannelInput,
  CreateChannelInputSchema,
  DmBlockStatusDto,
  MuteChannelInput,
  MuteChannelInputSchema,
  TenantRole,
  TransferOwnershipInput,
  TransferOwnershipInputSchema,
  UpdateChannelInput,
  UpdateChannelInputSchema,
  UpdateChannelMemberRoleInput,
  UpdateChannelMemberRoleInputSchema,
} from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { ChannelsService } from './channels.service';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @ZodBody(CreateChannelInputSchema) body: CreateChannelInput,
  ): Promise<ChannelDto> {
    return this.channelsService.create(user.tenantId, user.sub, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ChannelDto[]> {
    return this.channelsService.listForUser(user.tenantId, user.sub);
  }

  @Roles(TenantRole.ADMIN)
  @Get('admin')
  listAll(@CurrentUser() user: RequestUser): Promise<ChannelDto[]> {
    return this.channelsService.listAllForTenant(user.tenantId);
  }

  /** Public channels in the tenant the caller can still join (not a member, not banned). */
  @Get('discover')
  discover(@CurrentUser() user: RequestUser): Promise<ChannelDto[]> {
    return this.channelsService.listDiscoverable(user.tenantId, user.sub);
  }

  @Post(':id/join')
  join(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    return this.channelsService.join(user.tenantId, user.sub, id);
  }

  @Post(':id/leave')
  leave(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    return this.channelsService.leave(user.tenantId, user.sub, id);
  }

  @Get(':id/members')
  listMembers(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<ChannelMemberDto[]> {
    return this.channelsService.listMembers(user.tenantId, id);
  }

  /** Add existing community members to a group channel after creation (channel admin+). */
  @Post(':id/members')
  addMembers(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @ZodBody(AddChannelMembersInputSchema) body: AddChannelMembersInput,
  ): Promise<ChannelMemberDto[]> {
    return this.channelsService.addMembers(user.tenantId, user.sub, user.role as TenantRole, id, body.userIds);
  }

  @Patch(':id/members/:userId')
  updateMemberRole(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @ZodBody(UpdateChannelMemberRoleInputSchema) body: UpdateChannelMemberRoleInput,
  ): Promise<ChannelMemberDto> {
    return this.channelsService.updateMemberRole(
      user.tenantId,
      user.sub,
      user.role as TenantRole,
      id,
      targetUserId,
      body.role,
    );
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.channelsService.removeMember(user.tenantId, user.sub, user.role as TenantRole, id, targetUserId);
  }

  @Patch(':id')
  updateChannel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @ZodBody(UpdateChannelInputSchema) body: UpdateChannelInput,
  ): Promise<ChannelDto> {
    return this.channelsService.updateChannel(user.tenantId, user.sub, user.role as TenantRole, id, body);
  }

  @Delete(':id')
  deleteChannel(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    return this.channelsService.deleteChannel(user.tenantId, user.sub, user.role as TenantRole, id);
  }

  @Post(':id/ban/:userId')
  banMember(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.channelsService.banMember(user.tenantId, user.sub, user.role as TenantRole, id, targetUserId);
  }

  @Delete(':id/ban/:userId')
  unbanMember(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.channelsService.unbanMember(user.tenantId, user.sub, user.role as TenantRole, id, targetUserId);
  }

  @Patch(':id/mute')
  setMuted(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @ZodBody(MuteChannelInputSchema) body: MuteChannelInput,
  ): Promise<void> {
    return this.channelsService.setMuted(user.tenantId, user.sub, id, body.muted);
  }

  @Get(':id/block-status')
  getBlockStatus(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<DmBlockStatusDto> {
    return this.channelsService.getDmBlockStatus(user.tenantId, user.sub, id);
  }

  @Post(':id/block')
  block(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    return this.channelsService.blockInDm(user.tenantId, user.sub, id);
  }

  @Delete(':id/block')
  unblock(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<void> {
    return this.channelsService.unblockInDm(user.tenantId, user.sub, id);
  }

  @Post(':id/transfer-ownership')
  transferOwnership(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @ZodBody(TransferOwnershipInputSchema) body: TransferOwnershipInput,
  ): Promise<void> {
    return this.channelsService.transferOwnership(user.tenantId, user.sub, id, body.targetUserId);
  }
}
