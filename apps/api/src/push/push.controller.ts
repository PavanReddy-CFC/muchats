import { Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  RegisterDeviceTokenInput,
  RegisterDeviceTokenInputSchema,
  SetTenantPushConfigInput,
  SetTenantPushConfigInputSchema,
  TenantPushConfigStatusDto,
  TenantRole,
} from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { DeviceTokensService } from './device-tokens.service';
import { PushConfigService } from './push-config.service';

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(
    private readonly deviceTokens: DeviceTokensService,
    private readonly pushConfig: PushConfigService,
  ) {}

  /** Self-service — call once after obtaining an FCM token (app launch + whenever the OS
   *  reissues one via the token-refresh callback). Re-registering the same token is a no-op
   *  upsert, so it's safe to call on every app foreground without de-duping client-side. */
  @Post('device-tokens')
  async registerDeviceToken(
    @CurrentUser() user: RequestUser,
    @ZodBody(RegisterDeviceTokenInputSchema) body: RegisterDeviceTokenInput,
  ): Promise<void> {
    await this.deviceTokens.register(user.tenantId, user.sub, body);
  }

  /** Call on logout so a signed-out device stops receiving push for the account it just left. */
  @Delete('device-tokens/:token')
  async unregisterDeviceToken(@CurrentUser() user: RequestUser, @Param('token') token: string): Promise<void> {
    await this.deviceTokens.unregister(user.tenantId, token);
  }

  @Roles(TenantRole.ADMIN)
  @Get('tenant-config')
  getTenantConfig(@CurrentUser() user: RequestUser): Promise<TenantPushConfigStatusDto> {
    return this.pushConfig.getStatus(user.tenantId);
  }

  /** Paste the full Firebase service-account JSON (Project settings -> Service accounts ->
   *  Generate new private key). Encrypted at rest; never returned back by any endpoint after
   *  this — getTenantConfig only ever reports whether one is set and which project it's for. */
  @Roles(TenantRole.ADMIN)
  @Put('tenant-config')
  setTenantConfig(
    @CurrentUser() user: RequestUser,
    @ZodBody(SetTenantPushConfigInputSchema) body: SetTenantPushConfigInput,
  ): Promise<TenantPushConfigStatusDto> {
    return this.pushConfig.setConfig(user.tenantId, body.serviceAccountJson);
  }

  @Roles(TenantRole.ADMIN)
  @Delete('tenant-config')
  async clearTenantConfig(@CurrentUser() user: RequestUser): Promise<void> {
    await this.pushConfig.clearConfig(user.tenantId);
  }
}
