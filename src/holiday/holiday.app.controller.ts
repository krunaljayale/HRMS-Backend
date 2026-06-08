import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { HolidayService } from './holiday.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/app/holidays')
@UseGuards(JwtAuthGuard)
export class HolidayAppController {
  constructor(private readonly holidayService: HolidayService) {}

  @Post()
  async create(@Body() createHolidayDto: CreateHolidayDto, @Req() req: any) {
    // Extract ID securely from the JWT Token
    const adminId = req.user.id || req.user._id || req.user.sub;
    
    const data = await this.holidayService.create(createHolidayDto, adminId);
    return { success: true, message: 'Holiday added to calendar', data };
  }

  // e.g., GET /api/app/holidays?year=2026
  @Get()
  async findAll(@Query('year', ParseIntPipe) year: number) {
    const data = await this.holidayService.findAllByYear(year);
    return { success: true, data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // Triggers the Soft Delete
    const result = await this.holidayService.softDelete(id);
    return { success: true, ...result };
  }
}