import { Controller, Get } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';

@Controller('api/v1/settings')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) { }

  @Get('system-configs')
  async getSystemConfigs() {
    const configData = await this.systemConfigService.getActiveConfig();

    // Return the envelope response
    return {
      success: true,
      message: 'System configurations loaded successfully',
      data: configData,
    };
  }
}