import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplyLeaveDto } from './dto/apply-leave.dto';

@Controller('api/app/leaves')
export class LeaveAppController {
    constructor(private readonly leaveService: LeaveService) { }


    @UseGuards(JwtAuthGuard)
    @Get('my')
    async getMyLeaves(
        @Req() req: any,
        @Query('limit') limit?: string
    ) {
        const employeeId = req.user.employeeId;

        // Convert the string query param to a number, defaulting to 50
        const parsedLimit = limit ? parseInt(limit, 10) : 50;

        const data = await this.leaveService.getEmployeeLeaveHistory(employeeId, parsedLimit);

        return {
            statusCode: 200,
            data: data, // Contains both { leaves: [...], summary: {...} }
            message: 'Leave history fetched successfully'
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('apply')
    async applyForLeave(
        @Req() req: any,
        @Body() dto: ApplyLeaveDto
    ) {
        const employeeId = req.user.employeeId;

        const data = await this.leaveService.applyForLeave(employeeId, dto);

        return {
            statusCode: 200,
            data: data,
            message: 'Leave request submitted successfully'
        }
    }


    @UseGuards(JwtAuthGuard)
    @Get('ledger')
    async getMyLeaveLedger(
        @Req() req: any,
        @Query('status') status?: string
    ) {
        const employeeId = req.user.employeeId;

        const data = await this.leaveService.getLeaveLedger(employeeId, status);
        return {
            statusCode: 200,
            data: data,
            message: 'Leave ledger fetched successfully'
        }
    }
}