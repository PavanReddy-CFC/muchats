import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthTokens,
  CommunityMembershipDto,
  FederatedLoginInput,
  FederatedLoginInputSchema,
  LoginInput,
  LoginInputSchema,
  MeDto,
  RefreshInput,
  RefreshInputSchema,
  RegisterInput,
  RegisterInputSchema,
  SwitchCommunityInput,
  SwitchCommunityInputSchema,
} from '@qennect/shared-types';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@ZodBody(RegisterInputSchema) body: RegisterInput): Promise<AuthTokens> {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@ZodBody(LoginInputSchema) body: LoginInput): Promise<AuthTokens> {
    return this.authService.login(body);
  }

  /** Trusts Qennect's own auth instead of a muchats-invented password — see
   *  AuthService.federatedLogin for the full flow and the chat-user-id-equals-Qennect-
   *  member-id guarantee. */
  @Public()
  @Post('federated-login')
  @HttpCode(HttpStatus.OK)
  federatedLogin(@ZodBody(FederatedLoginInputSchema) body: FederatedLoginInput): Promise<AuthTokens> {
    return this.authService.federatedLogin(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@ZodBody(RefreshInputSchema) body: RefreshInput): Promise<AuthTokens> {
    return this.authService.refresh(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<MeDto> {
    return this.authService.getMe(user.tenantId, user.sub);
  }

  /** Every community this logged-in user belongs to — same userId (`sub`) regardless of
   *  which community the current access token happens to be scoped to. */
  @Get('communities')
  listMyCommunities(@CurrentUser() user: RequestUser): Promise<CommunityMembershipDto[]> {
    return this.authService.listMyCommunities(user.sub);
  }

  /** Switches the active community by id, using the caller's proven identity (`sub`) — no
   *  password re-entry. Rejects with 403 if the user isn't a member of that community. */
  @Post('switch-community')
  @HttpCode(HttpStatus.OK)
  switchCommunity(
    @CurrentUser() user: RequestUser,
    @ZodBody(SwitchCommunityInputSchema) body: SwitchCommunityInput,
  ): Promise<AuthTokens> {
    return this.authService.switchCommunity(user.sub, body.tenantId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: RequestUser): Promise<void> {
    await this.authService.logoutAllDevices(user.tenantId, user.sub);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: RequestUser): Promise<void> {
    await this.authService.logoutSession(user.sessionId);
  }
}
