import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckInDto, CheckOutDto } from './dto/punch.dto';
import { TrackLocationDto } from './dto/track-location.dto';
import { CorrectionRequestDto } from './dto/request-correction.dto';
import { Types } from 'mongoose';

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

  @UseGuards(JwtAuthGuard)
  @Get('monthly')
  async getMonthlyAttendance(
    @Req() req: any,
    @Query('year') year: string,
    @Query('month') month: string
  ) {
    const employeeId = req.user.employeeId || req.user.id;

    // Fallback to current year/month if frontend doesn't provide them
    const targetYear = year || new Date().getFullYear().toString();
    const targetMonth = month || (new Date().getMonth() + 1).toString();

    const data = await this.attendanceService.getMonthlyAttendanceList(
      employeeId,
      targetYear,
      targetMonth
    );

    return {
      statusCode: 200,
      data: data,
      message: 'Monthly attendance retrieved successfully'
    };
  }

  // ─── REQUEST CORRECTION ───
  @UseGuards(JwtAuthGuard)
  @Post('correction/:id')
  async requestCorrection(
    @Req() req: any,
    @Param('id') attendanceId: string,
    @Body() dto: CorrectionRequestDto
  ) {
    const employeeId = req.user.employeeId;

    const result = await this.attendanceService.requestCorrection(
      attendanceId,
      employeeId,
      dto
    );

    return {
      statusCode: 200,
      data: result,
      message: result.message,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('team-reports')
  async getTeamReports(
    @Req() req,
    @Query('date') date: string,
  ) {
    // Securely extract the identity from the verified token object context
    const managerId = req.user.employeeId;

    if (!date) {
      throw new BadRequestException('Date query parameter is required.');
    }

    const data = await this.attendanceService.getTeamReportsForManager(managerId, date);

    return {
      statusCode: 200,
      data: data,
      message: 'Team work reports fetched successfully.'
    };
  }

  /**
   * Updates the read/reviewed status tracker flag for an individual work report document.
   * Route: PATCH /api/app/attendance/work-reports/:reportId/read-status
   */
  @UseGuards(JwtAuthGuard)
  @Patch('work-reports/:reportId/read-status')
  async updateReportReadStatus(
    @Param('reportId') reportId: string,
    @Body('isReportRead') isReportRead: boolean,
  ) {
    if (!Types.ObjectId.isValid(reportId)) {
      throw new BadRequestException('Invalid work report ID format provided.');
    }
    if (typeof isReportRead !== 'boolean') {
      throw new BadRequestException('isReportRead body parameter must be a boolean value.');
    }

    const data = await this.attendanceService.updateWorkReportReadStatus(reportId, isReportRead);

    return {
      statusCode: 200,
      data: data,
      message: 'Work report status updated successfully.'
    };
  }


}