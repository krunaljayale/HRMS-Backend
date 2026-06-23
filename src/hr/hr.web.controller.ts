import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeeService } from '../employee/employee.service';
import { LeaveService } from '../leave/leave.service';

@Controller('api/web/hr')
export class HrWebController {
  constructor(
    private readonly hrService: HrService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeService: EmployeeService,
    private readonly leaveService: LeaveService,
  ) { }

  @Get('get-general-stats')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getGeneralStats() {
    return await this.hrService.getGeneralStats();
  }

  @Get('get-average-stats')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getAverageAttendanceStats(@Query('type') type: string) {
    // 1. Validate query parameters strictly before querying the DB
    if (!type || (type !== 'monthly' && type !== 'yearly')) {
      throw new BadRequestException('Query parameter "type" must be either "monthly" or "yearly"');
    }

    // 2. Delegate data aggregation to the service layer
    return this.attendanceService.getAggregateAttendanceStats(type);
  }

  @Get('get-department-stats')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getDepartmentStats() {
    return this.employeeService.getDepartmentWiseCount();
  }

  @Get('get-recent-joined-employees')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getRecentEmployees() {
    return this.employeeService.getRecentHires();
  }

  @Get('get-upcoming-birthdays')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getUpcomingBirthdays() {
    return this.employeeService.getUpcomingBirthdays();
  }

  @Get('attendance/live-roster')
  @UseGuards(JwtAuthGuard)
  async getLiveRoster(
    @Query('department') department?: string,
    @Query('workMode') workMode?: string,
    @Query('search') search?: string,
  ) {
    // Pass the query parameters down to the service layer
    const data = await this.attendanceService.getLiveRoster({
      department,
      workMode,
      search,
    });

    // Wrap the response in your standard success envelope
    return {
      success: true,
      message: 'Live roster fetched successfully',
      data: data
    };
  }

  @Get('attendance/pending-corrections-count')
  @UseGuards(JwtAuthGuard)
  async getPendingCorrectionsCount() {
    const count = await this.attendanceService.getPendingCorrectionsCount();

    return {
      success: true,
      message: 'Pending corrections count fetched successfully',
      data: {
        count: count
      }
    };
  }

  @Get('attendance/corrections')
  @UseGuards(JwtAuthGuard)
  async getCorrections(@Query('status') status?: string) {
    const data = await this.attendanceService.getCorrections(status);

    return {
      success: true,
      message: 'Pending corrections fetched successfully',
      data: data
    };
  }

  @Patch('attendance/corrections/:id/approve')
  @UseGuards(JwtAuthGuard)
  async approveCorrection(@Param('id') attendanceId: string, @Req() req: any) {
    // Extract HR admin ID from the JWT token
    const adminId = req.user.sub;

    await this.attendanceService.approveCorrection(attendanceId, adminId);

    return { success: true, message: 'Correction approved successfully' };
  }

  @Patch('attendance/corrections/:id/reject')
  @UseGuards(JwtAuthGuard)
  async rejectCorrection(@Param('id') attendanceId: string, @Req() req: any) {
    const adminId = req.user.sub;

    await this.attendanceService.rejectCorrection(attendanceId, adminId);

    return { success: true, message: 'Correction rejected successfully' };
  }

  @Get('attendance/historical-ledger')
  @UseGuards(JwtAuthGuard)
  async getHistoricalLedger(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.attendanceService.getHistoricalLedger({
      page, limit, search, department, startDate, endDate, status
    });

    return {
      success: true,
      message: 'Historical ledger fetched successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('leaves/pending')
  async getPendingLeaves() {
    const pendingLeaves = await this.leaveService.getPendingLeavesForHR();

    return {
      success: true,
      message: 'Pending leaves fetched successfully',
      data: pendingLeaves,
    };
  }

  @Patch('leaves/:id/approve')
  @UseGuards(JwtAuthGuard)
  async approveLeave(@Param('id') leaveId: string, @Req() req: any) {
    // req.user.employeeId represents the logged-in HR Admin's ID
    const hrAdminId = req.user.employeeId;

    await this.leaveService.approveLeaveStep(leaveId, 'HR', hrAdminId);

    return {
      success: true,
      message: 'Leave application approved successfully',
    };
  }

  @Patch('leaves/:id/reject')
  @UseGuards(JwtAuthGuard)
  async rejectLeave(
    @Param('id') leaveId: string,
    @Body('remarks') remarks: string,
    @Req() req: any
  ) {
    // req.user.employeeId represents the logged-in HR Admin's ID
    const hrAdminId = req.user.employeeId;

    await this.leaveService.rejectLeave(leaveId, 'HR', hrAdminId, remarks);

    return {
      success: true,
      message: 'Leave application rejected and tokens refunded successfully',
    };
  }

  @Get('leaves/historical')
  @UseGuards(JwtAuthGuard)
  async getHistoricalLeaves(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.leaveService.getHistoricalLeaves({
      page, limit, search, department, startDate, endDate, status
    });

    return {
      success: true,
      message: 'Historical leaves fetched successfully',
      data: result.data,
      meta: result.meta
    };
  }

}
