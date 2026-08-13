import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Query, Req, Request, UseGuards } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { LeaveService } from '../leave/leave.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/web/employee')
export class EmployeeWebController {

    constructor(
        private readonly employeeService: EmployeeService,
        private readonly leaveService: LeaveService,
    ) { }

    @Get('profile')
    async getProfile(@Req() req) {
        // 2. Extract ID attached by JwtStrategy.validate()
        const userId = req.user.employeeId;

        // 3. Fetch profile
        const profile = await this.employeeService.getEmployeeById(userId);

        if (!profile) {
            throw new NotFoundException('Employee profile not found');
        }

        // 4. Return unified JSON structure matching your attendance controller
        return {
            statusCode: 200,
            message: 'Profile fetched successfully',
            data: profile,
        };
    }

}
