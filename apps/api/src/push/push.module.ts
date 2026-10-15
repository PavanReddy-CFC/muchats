import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushConfigService } from './push-config.service';
import { DeviceTokensService } from './device-tokens.service';
import { BadgeService } from './badge.service';
import { FirebaseAppRegistryService } from './firebase-app-registry.service';
import { PushSenderService } from './push-sender.service';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  controllers: [PushController],
  providers: [PushConfigService, DeviceTokensService, BadgeService, FirebaseAppRegistryService, PushSenderService],
  exports: [PushSenderService, DeviceTokensService],
})
export class PushModule {}
