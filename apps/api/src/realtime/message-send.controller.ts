import { Controller, HttpCode, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MessageDto, SendMessageInput, SendMessageInputSchema } from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { MessagesService } from '../messages/messages.service';
import { WsRateLimiterService } from './ws-rate-limiter.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * REST fallback for sending a message.
 *
 * Sending was WebSocket-only, which made the socket a single point of failure for the one
 * operation users cannot tolerate losing: a client behind a proxy/VPN/NAT that blocks the
 * WS upgrade could read history over REST but never send. Everything else in the API already
 * had an HTTP path; this closes that gap.
 *
 * Lives alongside the gateway (rather than in MessagesModule) for the same reason
 * ModerationController does — it needs to broadcast the resulting `message:new`, and
 * RealtimeModule already imports MessagesModule, so putting it there would create a cycle.
 * The route is still `POST /messages`, sharing the path prefix with MessagesController's
 * `GET /messages` (different verbs, no collision).
 *
 * Safe to retry, and safe to race against the WS path: MessagesService.send is idempotent on
 * (channelId, clientMsgId), so a message that was already delivered over the socket returns
 * the original row rather than creating a duplicate.
 */
@ApiTags('messages')
@Controller('messages')
export class MessageSendController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly rateLimiter: WsRateLimiterService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async send(
    @CurrentUser() user: RequestUser,
    @ZodBody(SendMessageInputSchema) body: SendMessageInput,
  ): Promise<MessageDto> {
    // Shares the gateway's limiter rather than having its own: with a separate budget (or
    // none at all) this endpoint would simply be a way around the WS rate limit.
    const allowed = await this.rateLimiter.allow(user.tenantId, user.sub);
    if (!allowed) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Channel membership is enforced inside send() via assertChannelMember — the same check
    // the WS path relies on, so this endpoint grants no extra reach.
    const message = await this.messagesService.send(user.tenantId, user.sub, body);
    this.gateway.broadcastMessageNew(user.tenantId, message);
    return message;
  }
}
