import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { UpsertAlertDto } from './dto/upsert-alert.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Alerts')
@Controller('api/web/alert')
export class AlertWebController {
  constructor(private readonly alertService: AlertService) { }
}