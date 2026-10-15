import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ListMessagesQuery,
  ListMessagesQuerySchema,
  ListReadReceiptsQuery,
  ListReadReceiptsQuerySchema,
  MessageDto,
  MessageSearchResultDto,
  ReadReceiptDto,
  SearchMessagesQuery,
  SearchMessagesQuerySchema,
} from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { ZodQuery } from '../common/decorators/zod-body.decorator';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @ZodQuery(ListMessagesQuerySchema) query: ListMessagesQuery,
  ): Promise<MessageDto[]> {
    return this.messagesService.list(user.tenantId, user.sub, query);
  }

  @Get('search')
  search(
    @CurrentUser() user: RequestUser,
    @ZodQuery(SearchMessagesQuerySchema) query: SearchMessagesQuery,
  ): Promise<MessageSearchResultDto[]> {
    return this.messagesService.search(user.tenantId, user.sub, query);
  }

  @Get('receipts')
  listReceipts(
    @CurrentUser() user: RequestUser,
    @ZodQuery(ListReadReceiptsQuerySchema) query: ListReadReceiptsQuery,
  ): Promise<ReadReceiptDto[]> {
    return this.messagesService.listReceipts(user.tenantId, user.sub, query.channelId);
  }
}
