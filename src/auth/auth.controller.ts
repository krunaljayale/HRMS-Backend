import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmployeeService } from '../employee/employee.service';
import { HrService } from '../hr/hr.service';
import { DirectorService } from '../director/director.service';

@Controller('api/auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly employeeService: EmployeeService,
        private readonly hrService: HrService,
        private readonly directorService: DirectorService,
    ) { }

    // ── 1. EMPLOYEE LOGIN (e.g., IA00001) ──
    @Post('employee/login')
    async employeeLogin(@Body() loginDto: any) {
        if (!loginDto.employeeCode || !loginDto.password) {
            throw new UnauthorizedException('Employee Code and Password are required');
        }

        // 1. Get the safe user object (password already stripped in the service)
        const realUser = await this.employeeService.validatePassword(
            loginDto.employeeCode,
            loginDto.password
        );

        if (!realUser) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const tokens = await this.authService.generateAuthTokens(
            realUser._id.toString(),
            realUser.role
        );

        // ✅ FIXED: Now matching your React Native LoginResponse interface perfectly
        return {
            success: true,
            message: 'Employee login successful',
            data: {
                employee: realUser,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        };
    }

    // ── 2. HR LOGIN (e.g., IAHR00001) ──
    @Post('hr/login')
    async hrLogin(@Body() loginDto: any) {

        if (!loginDto.idCode || !loginDto.password) {
            throw new UnauthorizedException('ID Code and Password are required');
        }
        const hr = await this.hrService.validatePassword(loginDto.idCode, loginDto.password);

        if (!hr) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        const tokens = await this.authService.generateAuthTokens(hr._id.toString(), 'HR');
        return { success: true, message: 'HR login successful', data: tokens };
    }

    // ── 3. DIRECTOR LOGIN ──
    @Post('director/login')
    async directorLogin(@Body() loginDto: any) {

        if (!loginDto.idCode || !loginDto.password) {
            throw new UnauthorizedException('ID Code and Password are required');
        }

        const director = await this.directorService.validatePassword(
            loginDto.idCode,
            loginDto.password
        );

        if (!director) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        // Generate tokens using the director's _id and assign the 'Director' role
        const tokens = await this.authService.generateAuthTokens(director._id.toString(), 'Director');

        return {
            success: true,
            message: 'Director login successful',
            data: tokens
        };
    }

    // ── 4. UNIFIED REFRESH ROUTE ──
    // The refresh route stays unified! The JWT token already knows if they are an Employee or HR 
    // because we saved the 'role' inside the token payload during login.
    @Post('refresh')
    async refresh(@Body('refreshToken') refreshToken: string) {
        if (!refreshToken) throw new UnauthorizedException('Refresh token required');

        const newAccessToken = await this.authService.refreshAccessToken(refreshToken);

        return {
            success: true,
            message: 'Token refreshed successfully',
            data: { accessToken: newAccessToken },
        };
    }

}