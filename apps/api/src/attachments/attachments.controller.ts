import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AttachmentViewUrl,
  RequestUploadInput,
  RequestUploadInputSchema,
  RequestUploadResult,
} from '@qennect/shared-types';
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { AttachmentsService } from './attachments.service';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('upload-url')
  requestUpload(
    @CurrentUser() user: RequestUser,
    @ZodBody(RequestUploadInputSchema) body: RequestUploadInput,
  ): Promise<RequestUploadResult> {
    return this.attachmentsService.requestUpload(user.tenantId, user.sub, body);
  }

  @Get(':id')
  getViewUrl(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<AttachmentViewUrl> {
    return this.attachmentsService.getViewUrl(user.tenantId, user.sub, id);
  }
}
