import { Controller, UseGuards,  } from '@nestjs/common';
import { HolidayService } from './holiday.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/web/holidays')
@UseGuards(JwtAuthGuard)
export class HolidayWebController {
  constructor(private readonly holidayService: HolidayService) { }
}