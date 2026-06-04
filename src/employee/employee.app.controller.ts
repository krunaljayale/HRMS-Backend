import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/app/employee')
export class EmployeeAppController {
    constructor(private readonly employeeService: EmployeeService) { }


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
}
