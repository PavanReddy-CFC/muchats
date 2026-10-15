import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import { WsRateLimiterService } from './ws-rate-limiter.service';
import { MessageSendController } from './message-send.controller';
import { ModerationController } from './moderation.controller';
import { ChannelsModule } from '../channels/channels.module';
import { MessagesModule } from '../messages/messages.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [JwtModule.register({}), ChannelsModule, MessagesModule, PushModule],
  controllers: [ModerationController, MessageSendController],
  providers: [RealtimeGateway, PresenceService, WsRateLimiterService],
})
export class RealtimeModule {}
