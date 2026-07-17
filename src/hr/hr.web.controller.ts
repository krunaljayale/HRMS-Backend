import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeeService } from '../employee/employee.service';
import { LeaveService } from '../leave/leave.service';
import {
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import 'multer';
import { GetPayrollListQueryDto } from '../payroll/dto/get-payroll-list.dto';
import { PayrollService } from '../payroll/payroll.service';
import { ProcessAllActivePayrollDto } from '../payroll/dto/process-all-active-payroll.dto';
import { ReimbursementService } from '../reimbursement/reimbursement.service';
import { ChangePasswordDto } from '../employee/dto/change-password.dto';

@Controller('api/web/hr')
export class HrWebController {
  constructor(
    private readonly hrService: HrService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeService: EmployeeService,
    private readonly leaveService: LeaveService,
    private readonly payrollService: PayrollService,
    private readonly reimbursementService: ReimbursementService,
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
      throw new BadRequestException(
        'Query parameter "type" must be either "monthly" or "yearly"',
      );
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
      data: data,
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
        count: count,
      },
    };
  }

  @Get('attendance/corrections')
  @UseGuards(JwtAuthGuard)
  async getCorrections(@Query('status') status?: string) {
    const data = await this.attendanceService.getCorrections(status);

    return {
      success: true,
      message: 'Pending corrections fetched successfully',
      data: data,
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
  async rejectCorrection(
    @Param('id') attendanceId: string,
    @Body('remark') remark: string,
    @Req() req: any
  ) {
    const adminId = req.user.sub;

    // Backend validation: Ensure the remark is not empty
    if (!remark || !remark.trim()) {
      throw new BadRequestException('A rejection remark is strictly required.');
    }

    // Pass the extracted remark into the service
    await this.attendanceService.rejectCorrection(attendanceId, adminId, remark.trim());

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
    @Req() req: any,
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
      message: 'Historical leaves fetched successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('employees')
  @UseGuards(JwtAuthGuard)
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

  @Get('employees/leadership')
  @UseGuards(JwtAuthGuard)
  async getLeadership() {
    const leadership = await this.employeeService.getLeadership();

    return {
      success: true,
      message: 'Leadership fetched successfully',
      data: leadership,
    };
  }

  @Get('employees/new-code')
  @UseGuards(JwtAuthGuard)
  async getNewEmployeeCode() {
    const newCode = await this.employeeService.generateNewEmployeeCode();

    return {
      success: true,
      message: 'New employee code generated successfully',
      data: newCode,
    };
  }

  @Post('employees/create')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'profileImage', maxCount: 1 },
      { name: 'experienceCertificate', maxCount: 1 },
      { name: 'twelfthMarksheet', maxCount: 1 },
      { name: 'tenthMarksheet', maxCount: 1 },
      { name: 'graduationMarksheet', maxCount: 1 },
      { name: 'postGraduationMarksheet', maxCount: 1 },
      { name: 'aadhaarFile', maxCount: 1 },
      { name: 'panFile', maxCount: 1 },
      { name: 'passbookFile', maxCount: 1 },
      { name: 'medicalDocument', maxCount: 1 },
    ]),
  )
  async createNewEmployee(
    @Body() employeeData: any,
    @UploadedFiles()
    files: {
      profileImage?: Express.Multer.File[];
      experienceCertificate?: Express.Multer.File[];
      twelfthMarksheet?: Express.Multer.File[];
      tenthMarksheet?: Express.Multer.File[];
      graduationMarksheet?: Express.Multer.File[];
      postGraduationMarksheet?: Express.Multer.File[];
      aadhaarFile?: Express.Multer.File[];
      panFile?: Express.Multer.File[];
      passbookFile?: Express.Multer.File[];
      medicalDocument?: Express.Multer.File[];
    },
  ) {
    return this.employeeService.createEmployeeProfile(employeeData, files);
  }

  @Get('employees/:id')
  @UseGuards(JwtAuthGuard)
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

  @Put('employees/:id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'profileImage', maxCount: 1 },
      { name: 'experienceCertificate', maxCount: 1 },
      { name: 'twelfthMarksheet', maxCount: 1 },
      { name: 'tenthMarksheet', maxCount: 1 },
      { name: 'graduationMarksheet', maxCount: 1 },
      { name: 'postGraduationMarksheet', maxCount: 1 },
      { name: 'aadhaarFile', maxCount: 1 },
      { name: 'panFile', maxCount: 1 },
      { name: 'passbookFile', maxCount: 1 },
      { name: 'medicalDocument', maxCount: 1 },
    ]),
  )
  async updateEmployeeProfile(
    @Param('id') id: string,
    @Body() employeeData: any,
    @UploadedFiles() files: Record<string, Express.Multer.File[]>,
  ) {
    return this.employeeService.updateEmployeeProfile(id, employeeData, files);
  }

  // ─── 1. STATIC PATHS GO FIRST ───
  @Get('payroll/payrollList')
  @UseGuards(JwtAuthGuard)
  async getPayrollList(
    @Req() req: any,
    @Query() queryDto: GetPayrollListQueryDto
  ) {
    const data = await this.payrollService.getPayrollList(req.user, queryDto);
    return data
  }

  @Post('payroll/process-all-active')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async getPendingReimbursements() {
    return await this.reimbursementService.getPendingClaimsForHr();
  }

  // Approve an incoming claim
  @Patch('reimbursement/:id/approve')
  @UseGuards(JwtAuthGuard)
  async approveReimbursement(
    @Param('id') id: string,
    @Req() req: any
  ) {
    const hrId = req.user.employeeId;
    if (!hrId) {
      throw new BadRequestException('HR operator identification context missing');
    }
    return await this.reimbursementService.approveClaimByHr(id, hrId);
  }

  // Reject an incoming claim with a mandatory justification reason
  @Patch('reimbursement/:id/reject')
  @UseGuards(JwtAuthGuard)
  async rejectReimbursement(
    @Param('id') id: string,
    @Body() body: { rejectionReason: string },
    @Req() req: any
  ) {
    const hrId = req.user.employeeId;
    if (!hrId) {
      throw new BadRequestException('HR operator identification context missing');
    }
    return await this.reimbursementService.rejectClaimByHr(id, hrId, body.rejectionReason);
  }

  @Get('reimbursement/historical')
  @UseGuards(JwtAuthGuard)
  async getHistoricalReimbursements() {
    return await this.reimbursementService.getHistoricalClaimsForHr();
  }

  @Get('get-profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getProfile() {
    return await this.hrService.getMasterProfile();
  }

  /**
   * Updates the underlying employee password shared across both profiles
   */
  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() changePasswordDto: ChangePasswordDto) {
    return await this.hrService.changeMasterPassword(changePasswordDto);
  }




}
