import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformStatsDto } from '@qennect/shared-types';
import { SuperAdmin } from '../common/decorators/super-admin.decorator';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@SuperAdmin()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('stats')
  getStats(): Promise<PlatformStatsDto> {
    return this.platformService.getStats();
  }
}
