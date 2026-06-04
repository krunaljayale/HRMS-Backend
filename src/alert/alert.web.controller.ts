import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { UpsertAlertDto } from './dto/upsert-alert.dto';

@ApiTags('Alerts') // Groups these under the "Alerts" section in the Swagger UI
@Controller('api/web/alert')
export class AlertWebController {
  constructor(private readonly alertService: AlertService) {}

  @Post('upsert')
  @ApiOperation({ summary: 'Admin: Create or update the global app alert' })
  @ApiResponse({ status: 201, description: 'The alert has been successfully updated.' })
  async upsertGlobalAlert(@Body() dto: UpsertAlertDto) {
    const updatedAlert = await this.alertService.upsertAlert(dto);
    return {
      success: true,
      message: 'Global alert updated successfully',
      data: updatedAlert,
    };
  }
}