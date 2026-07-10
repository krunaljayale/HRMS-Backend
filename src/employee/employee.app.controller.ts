import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Request, UseGuards } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateFcmTokenDto } from './dto/update-fcm.dto';
import { GetDirectoryDto } from './dto/get-directory.dto';
import { CreateFaceDto } from './dto/add-face-descriptor.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Types } from 'mongoose';
import { LeaveService } from '../leave/leave.service';

@Controller('api/app/employee')
export class EmployeeAppController {
    constructor(
        private readonly employeeService: EmployeeService,
        private readonly leaveService: LeaveService,
    ) { }

    @Get('profile')
    @UseGuards(JwtAuthGuard)
    async getProfile(@Request() req: any) {

        // 2. Extract the MongoDB _id that the JwtStrategy attached to the request
        const userId = req.user.employeeId;

        // 3. Pass that exact ID into your service function
        // (You can also pass a second argument like '-password' if you didn't hide it in the schema)
        const profile = await this.employeeService.getEmployeeById(userId);

        // 4. Return the standard JSON structure your frontend expects
        return {
            success: true,
            message: 'Profile fetched successfully',
            data: profile,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('change-password')
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @Req() req: any,
        @Body() changePasswordDto: ChangePasswordDto
    ) {
        const employeeID = req.user.employeeId;

        return this.employeeService.updatePassword(employeeID, changePasswordDto);
    }

    @Patch('profile/fcm-token')
    @UseGuards(JwtAuthGuard)
    async updateFcmToken(
        @Request() req: any,
        @Body() updateFcmTokenDto: UpdateFcmTokenDto
    ) {
        // Securely grab the ID from the JWT payload
        const userId = req.user.employeeId;

        // Pass the data to the service
        await this.employeeService.updateFcmToken(userId, updateFcmTokenDto);

        // Return a 200 OK success response to React Native
        return {
            success: true,
            message: 'FCM token updated successfully',
        };
    }

    // ── GET DIRECTORY ROUTE ──
    @Get('directory')
    @UseGuards(JwtAuthGuard)
    async getDirectory(@Query() queryDto: GetDirectoryDto) {

        // 1. Fetch data from service
        const directoryData = await this.employeeService.getEmployeeDirectory(queryDto);

        // 2. Return standard JSON envelope to match your frontend interceptor
        return {
            success: true,
            message: 'Employee directory fetched successfully',
            data: directoryData,
        };
    }

    // ── UPCOMING BIRTHDAYS ROUTE ──
    @Get('birthdays/upcoming')
    @UseGuards(JwtAuthGuard)
    async getBirthdays() {
        // Fetch the split arrays from the service
        const birthdayData = await this.employeeService.getUpcomingBirthdays();

        // 2. Return standard JSON envelope
        return {
            success: true,
            message: 'Upcoming birthdays fetched successfully',
            data: birthdayData,
        };
    }

    @Post('face')
    @UseGuards(JwtAuthGuard)
    async registerFaceId(
        @Request() req: any,
        @Body() createFaceDto: CreateFaceDto
    ) {
        const userId = req.user.employeeId;
        await this.employeeService.addFaceDescriptor(
            userId,
            createFaceDto.faceDescriptors,
            createFaceDto.image
        );
        return {
            success: true,
            message: 'Face ID profile secured successfully',
        };
    }

    @Get(':id/approval-metrics')
    async getApprovalMetrics(@Param('id') id: string) {
        // Basic verification check before sending execution down to the service layer
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid employee ID format passed in parameters.');
        }

        return await this.employeeService.getManagerApprovalMetrics(id);
    }

    @Get(':id/detailed-requests')
    async getDetailedRequests(@Param('id') id: string) {
        // Basic verification check before sending execution down to the service layer
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid employee ID format passed in parameters.');
        }

        return await this.employeeService.getManagerDetailedRequests(id);
    }

    @Get(':id/requests-history')
    async getRequestsHistory(
        @Param('id') id: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('status') status?: string,
    ) {
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid employee ID format passed in parameters.');
        }

        // Convert string query params to integers with default fallbacks
        const pageNum = parseInt(page || '1', 10);
        const limitNum = parseInt(limit || '10', 10);

        return await this.employeeService.getManagerActionHistory(id, pageNum, limitNum, status);
    }

    @Patch(':managerId/leaves/:leaveId/approve')
    async managerApproveLeave(
        @Param('managerId') managerId: string,
        @Param('leaveId') leaveId: string
    ) {
        if (!Types.ObjectId.isValid(managerId) || !Types.ObjectId.isValid(leaveId)) {
            throw new BadRequestException('Invalid manager or leave tracking ID format.');
        }

        return await this.leaveService.approveLeaveStepByManager(leaveId, managerId);
    }

    @Patch(':managerId/leaves/:leaveId/reject')
    async managerRejectLeave(
        @Param('managerId') managerId: string,
        @Param('leaveId') leaveId: string,
        @Body('remarks') remarks: string
    ) {
        if (!Types.ObjectId.isValid(managerId) || !Types.ObjectId.isValid(leaveId)) {
            throw new BadRequestException('Invalid manager or leave tracking ID format.');
        }

        return await this.leaveService.rejectLeaveStepByManager(leaveId, managerId, remarks);
    }

}
