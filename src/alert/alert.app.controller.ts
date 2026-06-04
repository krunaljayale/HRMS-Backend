import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { CheckAlertDto } from './dto/check-alert.dto';

@ApiTags('Alerts') // Groups these under the "Alerts" section in the Swagger UI
@Controller('api/app/alert')
export class AlertAppController {
  constructor(private readonly alertService: AlertService) { }

  @Post('check')
  @ApiOperation({ summary: 'Mobile App: Check if a global alert should be displayed' })
  @ApiResponse({ status: 200, description: 'Returns the alert data if an update or maintenance screen is required.' })
  async checkAppAlert(@Body() dto: CheckAlertDto) {
    const alert = await this.alertService.checkAlert(dto);

    if (!alert) {
      return { success: true, showAlert: false };
    }

    return {
      success: true,
      showAlert: true,
      data: alert,
    };
  }
}