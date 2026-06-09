import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckInDto, CheckOutDto } from './dto/punch.dto';
import { TrackLocationDto } from './dto/track-location.dto';

@Controller('api/app/attendance')
export class AttendanceAppController {
  constructor(private readonly attendanceService: AttendanceService) { }

  @UseGuards(JwtAuthGuard)
  @Get('today-status')
  async getTodayStatus(@Req() req) {
    const employeeId = req.user.employeeId;

    const data = await this.attendanceService.getTodayStatus(employeeId);

    return {
      statusCode: 200,
      data: data,
      message: 'Today status fetched successfully'
    };
  }

  // ─── CHECK IN ───
  @UseGuards(JwtAuthGuard)
  @Post('check-in')
  async checkIn(@Req() req, @Body() body: CheckInDto) {
    const data = await this.attendanceService.checkIn(req.user, body);

    return {
      statusCode: 200,
      data: {
        record: data.attendance,
        checkedInAt: data.checkedInAt
      },
      message: 'Checked in successfully',
    };
  }

  // ─── CHECK OUT ───
  @UseGuards(JwtAuthGuard)
  @Post('check-out')
  async checkOut(@Req() req, @Body() body: CheckOutDto) {
    const data = await this.attendanceService.checkOut(req.user, body);

    return {
      statusCode: 200,
      data: data,
      message: 'Checked out successfully',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('reporting-managers')
  async getReportingManagers(@Req() req) {
    const employeeId = req.user.employeeId;
    const data = await this.attendanceService.getReportingManager(employeeId);
    return {
      statusCode: 200,
      data: data,
      message: 'Reporting managers fetched successfully'
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('track-location')
  // @UseGuards(JwtAuthGuard) // Protect with your standard JWT guard
  async trackLocation(@Req() req, @Body() dto: TrackLocationDto) {
    await this.attendanceService.trackLocation(req.user.employeeId, dto);

    return {
      statusCode: 200,
      message: 'Location tracked successfully',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('insights/performance')
  async getPerformanceInsights(@Req() req: any) {
    const employeeId = req.user.employeeId;

    const insights = await this.attendanceService.getMonthlyPerformanceInsights(employeeId);

    return {
      statusCode: 200,
      data: insights,
      message: 'Performance insights retrieved successfully'
    };
  }
}