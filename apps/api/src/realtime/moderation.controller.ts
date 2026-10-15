import { Controller, Delete, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MessageDto, TenantRole } from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MessagesService } from '../messages/messages.service';
import { RealtimeGateway } from './realtime.gateway';

/** Lives alongside the gateway (rather than in MessagesModule) so it can broadcast the
 *  resulting `message:deleted` event without a MessagesModule <-> RealtimeModule import cycle
 *  — RealtimeModule already imports MessagesModule for the gateway's own use. */
@ApiTags('moderation')
@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @Roles(TenantRole.ADMIN)
  @Delete('messages/:id')
  async deleteMessage(
    @CurrentUser() user: RequestUser,
    @Param('id') messageId: string,
  ): Promise<MessageDto> {
    const message = await this.messagesService.adminDelete(user.tenantId, messageId);
    this.gateway.broadcastMessageDeleted(user.tenantId, message);
    return message;
  }
}
