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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeeService } from '../employee/employee.service';
import { LeaveService } from '../leave/leave.service';
import {
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import 'multer';

import { PayrollService } from '../payroll/payroll.service';
import { ReimbursementService } from '../reimbursement/reimbursement.service';
import { ChangePasswordDto } from '../employee/dto/change-password.dto';
import { ComplaintService } from '../complaint/complaint.service';
import { UpdateComplaintStatusDto } from '../complaint/dto/update-complaint-status.dto';

@Controller('api/web/hr')
export class HrWebController {
  constructor(
    private readonly hrService: HrService,
    private readonly attendanceService: AttendanceService,
    private readonly employeeService: EmployeeService,
    private readonly leaveService: LeaveService,
    private readonly reimbursementService: ReimbursementService,
    private readonly complaintService: ComplaintService,
  ) { }

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


  // ─── GET LIVE COMPLAINTS (Pending, Acknowledged, In Review) ───
  @Get('complaints/live')
  @UseGuards(JwtAuthGuard)
  async getLiveComplaints(@Query('search') search?: string) {
    return await this.complaintService.getHrLiveComplaints(search);
  }

  @Get('complaints/historical')
  @UseGuards(JwtAuthGuard)
  async getHistoricalComplaints(
    @Query('search') search?: string) {
    return await this.complaintService.getHistoricalComplaintsForHr(search);
  }


  @Patch('complaints/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateComplaintStatus(
    @Param('id') complaintId: string,
    @Body() body: Omit<UpdateComplaintStatusDto, 'actionBy' | 'role'>, // Frontend doesn't send these securely
    @Req() req: any,
  ) {
    // 1. Extract HR Admin ID securely from JWT token payload
    const adminId = req.user.employeeId;

    // 2. Construct the full DTO expected by your shared service method
    const updateDto: UpdateComplaintStatusDto = {
      status: body.status,
      comments: body.comments,
      actionBy: adminId,
      role: 'HR', // Hardcoded securely on backend
    };

    // 3. Call your existing service method
    return await this.complaintService.updateStatus(complaintId, updateDto);
  }

}
