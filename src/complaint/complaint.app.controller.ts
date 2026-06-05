import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ComplaintService } from './complaint.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/app/complaints')
@UseGuards(JwtAuthGuard)
export class ComplaintAppController {
  constructor(private readonly complaintService: ComplaintService) { }

  @Post()
  async create(@Body() createComplaintDto: CreateComplaintDto, @Req() req: any) {
    // SECURITY UPGRADE: Force the employee ID from the token instead of trusting the DTO
    createComplaintDto.employee = req.user.employeeId;

    const data = await this.complaintService.create(createComplaintDto);
    return {
      success: true,
      message: 'Complaint submitted successfully',
      data,
    };
  }

  // 🚀 NEW ENDPOINT: /api/app/complaints/my
  // MUST BE PLACED BEFORE @Get(':id')
  @Get('my')
  async findMyComplaints(@Req() req: any, @Query() query: any) {
    // 1. Extract the secure ID from the decoded JWT token
    const secureEmployeeId = req.user.employeeId;

    // 2. Override any spoofed employee IDs in the query with the real one
    query.employee = secureEmployeeId;

    // 3. Pass the safely filtered query to your existing service
    const data = await this.complaintService.findAll(query);
    return {
      success: true,
      data,
    };
  }

  @Get()
  async findAll(@Query() query: any) {
    // NOTE: This route should ideally be restricted to HR/Directors using a RolesGuard
    const data = await this.complaintService.findAll(query);
    return {
      success: true,
      data,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.complaintService.findOne(id);
    return {
      success: true,
      data,
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateComplaintStatusDto,
  ) {
    const data = await this.complaintService.updateStatus(id, updateDto);
    return {
      success: true,
      message: 'Complaint status updated successfully',
      data,
    };
  }
}