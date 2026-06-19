import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeeService } from '../employee/employee.service';

@Controller('api/web/hr')
export class HrWebController {
  constructor(
    private readonly hrService: HrService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeService: EmployeeService,
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

}
