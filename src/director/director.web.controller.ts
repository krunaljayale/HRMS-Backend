import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { LeaveService } from '../leave/leave.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DirectorService } from './director.service';
import { UpdateComplaintStatusDto } from '../complaint/dto/update-complaint-status.dto';
import { ComplaintService } from '../complaint/complaint.service';

@Controller('api/web/director')
export class DirectorWebController {
  constructor(
    private readonly leaveService: LeaveService,
    private readonly directorService: DirectorService,
    private readonly complaintService: ComplaintService,
  ) { }


  @Get('get-profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: any) {
    const directorId = req.user.employeeId;

    const profileData = await this.directorService.getSystemDirectorProfile(directorId);

    return {
      success: true,
      message: 'Director profile fetched successfully',
      data: profileData,
    };
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Req() req: any,
    @Body() changePasswordDto: any // Replace 'any' with your actual ChangePasswordDto if you have one
  ) {
    // Extract the Director's profile _id from the authenticated JWT payload
    const directorId = req.user.employeeId;

    // Execute the password rotation
    return await this.directorService.changeDirectorPassword(directorId, changePasswordDto);
  }

  @Get('leaves/pending')
  @UseGuards(JwtAuthGuard)
  async getPendingLeaves() {
    const pendingLeaves = await this.leaveService.getPendingLeavesForDirector();

    return {
      success: true,
      message: 'Pending leaves fetched successfully',
      data: pendingLeaves,
    };
  }

  @Patch('leaves/:id/approve')
  @UseGuards(JwtAuthGuard) // Assuming you have a specific guard for Directors
  async approveLeaveDirector(@Param('id') leaveId: string, @Req() req: any) {

    const directorId = req.user.employeeId;

    // Pass 'Director' as the acting profile, and the director's _id as the humanId
    await this.leaveService.approveLeaveStep(leaveId, 'Director', directorId);

    return {
      success: true,
      message: 'Leave application approved by Director successfully',
    };
  }

  @Patch('leaves/:id/reject')
  @UseGuards(JwtAuthGuard)
  async rejectLeaveDirector(
    @Param('id') leaveId: string,
    @Body('remarks') remarks: string,
    @Req() req: any,
  ) {
    //  CRITICAL FIX: Extract the Director's standard profile ID, not employeeId
    const directorId = req.user._id || req.user.id;

    // Pass 'Director' as the acting profile
    await this.leaveService.rejectLeave(leaveId, 'Director', directorId, remarks);

    return {
      success: true,
      message: 'Leave application rejected by Director and tokens refunded successfully',
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

  // ─── GET LIVE COMPLAINTS ───
  @Get('complaints/live')
  @UseGuards(JwtAuthGuard)
  async getDirectorLiveComplaints(@Query('search') search?: string) {
    return await this.complaintService.getDirectorLiveComplaints(search);
  }

  // ─── GET HISTORICAL COMPLAINTS ───
  @Get('complaints/historical')
  @UseGuards(JwtAuthGuard)
  async getDirectorHistoryComplaints(@Query('search') search?: string) {
    return await this.complaintService.getDirectorHistoryComplaints(search);
  }

  // ─── UPDATE COMPLAINT STATUS / ISSUE DIRECTIVE ───
  @Patch('complaints/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateDirectorComplaintStatus(
    @Param('id') complaintId: string,
    @Body() body: Omit<UpdateComplaintStatusDto, 'actionBy' | 'role'>,
    @Req() req: any,
  ) {
    const directorId = req.user.sub;

    const updateDto: UpdateComplaintStatusDto = {
      status: body.status,
      comments: body.comments,
      actionBy: directorId,
      role: 'DIRECTOR',
    };

    return await this.complaintService.updateStatus(complaintId, updateDto);
  }
}
