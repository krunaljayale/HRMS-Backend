import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ManagementService } from './management.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeeService } from '../employee/employee.service';
import { GetPayrollListQueryDto } from '../payroll/dto/get-payroll-list.dto';
import { PayrollService } from '../payroll/payroll.service';
import { ProcessAllActivePayrollDto } from '../payroll/dto/process-all-active-payroll.dto';
import type { Response } from 'express';
import { ReimbursementService } from '../reimbursement/reimbursement.service';
import { HolidayService } from '../holiday/holiday.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AlertService } from '../alert/alert.service';

@UseGuards(JwtAuthGuard)
@Controller('api/web/management')
export class ManagementController {
  constructor(
    private readonly managementService: ManagementService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeService: EmployeeService,
    private readonly payrollService: PayrollService,
    private readonly reimbursementService: ReimbursementService,
    private readonly holidayService: HolidayService,
    private readonly alertService: AlertService,
  ) { }

  @Get('get-general-stats')
  @HttpCode(HttpStatus.OK)
  async getGeneralStats() {
    return await this.managementService.getGeneralStats();
  }

  @Get('get-average-stats')
  @HttpCode(HttpStatus.OK)
  async getAverageAttendanceStats(@Query('type') type: string) {
    // 1. Validate query parameters strictly before querying the DB
    if (!type || (type !== 'monthly' && type !== 'yearly')) {
      throw new BadRequestException(
        'Query parameter "type" must be either "monthly" or "yearly"',
      );
    }

    // 2. Delegate data aggregation to the service layer
    return this.attendanceService.getAggregateAttendanceStats(type);
  }

  @Get('get-department-stats')
  @HttpCode(HttpStatus.OK)
  async getDepartmentStats() {
    return this.employeeService.getDepartmentWiseCount();
  }

  @Get('get-recent-joined-employees')
  @HttpCode(HttpStatus.OK)
  async getRecentEmployees() {
    return this.employeeService.getRecentHires();
  }

  @Get('get-upcoming-birthdays')
  @HttpCode(HttpStatus.OK)
  async getUpcomingBirthdays() {
    return this.employeeService.getUpcomingBirthdays();
  }

  @Get('attendance/live-roster')
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
      data: data,
    };
  }

  @Get('attendance/pending-corrections-count')
  async getPendingCorrectionsCount() {
    const count = await this.attendanceService.getPendingCorrectionsCount();

    return {
      success: true,
      message: 'Pending corrections count fetched successfully',
      data: {
        count: count,
      },
    };
  }

  @Get('attendance/corrections')
  async getCorrections(@Query('status') status?: string) {
    const data = await this.attendanceService.getCorrections(status);

    return {
      success: true,
      message: 'Pending corrections fetched successfully',
      data: data,
    };
  }

  @Get('attendance/historical-ledger')
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
      page,
      limit,
      search,
      department,
      startDate,
      endDate,
      status,
    });

    return {
      success: true,
      message: 'Historical ledger fetched successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('employees')
  async getAllEmployees(
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const result = await this.employeeService.getAllEmployeesForHR(
      search,
      department,
      status,
      Number(page),
      Number(limit),
    );

    return {
      success: true,
      message: 'Employees fetched successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('employees/:id')
  async getEmployee(
    @Param('id') employeeId: string,
    @Query('fields') fields?: string,
  ) {
    const selectFields = fields ? fields.split(',').join(' ') : undefined;

    const employee = await this.employeeService.getEmployeeById(employeeId, selectFields);

    return {
      success: true,
      message: 'Employee fetched successfully',
      data: employee,
    };
  }

  // ─── 1. STATIC PATHS GO FIRST ───
  @Get('payroll/payrollList')
  async getPayrollList(
    @Req() req: any,
    @Query() queryDto: GetPayrollListQueryDto
  ) {
    const data = await this.payrollService.getPayrollList(req.user, queryDto);
    return data
  }

  @Post('payroll/process-all-active')
  async processAllActive(
    @Req() req: any,
    @Body() body: ProcessAllActivePayrollDto
  ) {

    // 1. Parse and Validate Dates
    const fromDate = new Date(body.fromDate);
    const toDate = new Date(body.toDate);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid date format provided.');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('fromDate cannot be after toDate.');
    }

    // 2. Trigger the Batch Engine
    return await this.payrollService.generateAllEmployeesPayroll(
      fromDate,
      toDate,
      body.targetMonth,
      body.targetYear,
      req.user.employeeId
    );
  }

  @Get('payroll/export')
  async exportExcel(
    @Query('targetMonth') targetMonth: string,
    @Query('targetYear') targetYear: string,
    @Res() res: Response,
  ) {
    const month = parseInt(targetMonth, 10);
    const year = parseInt(targetYear, 10);

    const buffer = await this.payrollService.exportPayrollToExcel(month, year);

    const fileName = `Payroll_Summary_${month}_${year}.xlsx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=${fileName}`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get('payroll/salary-slip/:id')
  async downloadSalarySlip(
    @Param('id') payrollId: string,
    @Query('employeeId') targetEmployeeId: string,
    @Res() res: Response,
  ) {
    if (!targetEmployeeId) {
      // Add a quick safety check
      throw new BadRequestException('Target employee ID is required');
    }



    // Now it uses the specific employee's ID, not the HR admin's ID
    const pdfBuffer = await this.payrollService.generateSalarySlipPdf(payrollId, targetEmployeeId);

    const fileName = `SalarySlip_${payrollId}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  @Get('reimbursement/pending')
  async getPendingReimbursements() {
    return await this.reimbursementService.getPendingClaimsForHr();
  }

  @Get('reimbursement/historical')
  async getHistoricalReimbursements() {
    return await this.reimbursementService.getHistoricalClaimsForHr();
  }

  // Holidays Controllers
  // e.g., GET /api/web/management/holidays?year=2026
  @Get('holidays')
  async findAll(@Query('year', ParseIntPipe) year: number) {
    const data = await this.holidayService.findAllByYear(year);
    return { success: true, data };
  }

  @Get('announcements/check')
  @ApiOperation({ summary: 'Admin: Get all company announcements (info, promo)' })
  @ApiResponse({ status: 200, description: 'Returns a list of manageable alerts.' })
  async getAlerts() {
    const alerts = await this.alertService.getWebAlerts();

    return {
      success: true,
      message: 'Alerts fetched successfully',
      data: alerts,
    };
  }

}
