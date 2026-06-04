import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { UpsertAlertDto } from './dto/upsert-alert.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Alerts')
@Controller('api/web/alert')
export class AlertWebController {
  constructor(private readonly alertService: AlertService) { }

  @Post('upsert')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: Create or update the global app alert' })
  @ApiResponse({ status: 201, description: 'The alert has been successfully updated.' })
  async upsertGlobalAlert(
    @Body() dto: UpsertAlertDto,
    @Request() req: any
  ) {
    const employeeId = req.user.employeeId;
    const updatedAlert = await this.alertService.upsertAlert(dto, employeeId);

    return {
      success: true,
      message: 'Global alert updated successfully',
      data: updatedAlert,
    };
  }
}