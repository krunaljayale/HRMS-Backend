import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
    constructor(private jwtService: JwtService) { }

    // ── 1. LOGIN: Generate both tokens ──
    async generateAuthTokens(employeeId: string, role: string) {
        const payload = { sub: employeeId, role: role };

        const accessToken = this.jwtService.sign(payload, {
            expiresIn: '1m', // Dies quickly for security
            secret: process.env.JWT_ACCESS_SECRET || 'super_secret_development_key'
        });

        const refreshToken = this.jwtService.sign(payload, {
            expiresIn: '30d', // Lives for 30 days (Static approach)
            secret: process.env.JWT_REFRESH_SECRET || 'super_secret_refresh_key'
        });

        return { accessToken, refreshToken };
    }

    // ── 2. REFRESH: Verify old token, issue ONLY new access token ──
    async refreshAccessToken(refreshToken: string) {
        try {
            // Verify the refresh token hasn't expired or been tampered with
            const payload = this.jwtService.verify(refreshToken, {
                secret: process.env.JWT_REFRESH_SECRET || 'super_secret_refresh_key'
            });

            // Issue a brand new 15-minute access token using the exact same payload
            const newAccessToken = this.jwtService.sign(
                { sub: payload.sub, role: payload.role },
                {
                    expiresIn: '15m',
                    secret: process.env.JWT_ACCESS_SECRET || 'super_secret_development_key'
                }
            );

            return newAccessToken;
        } catch (error) {
            // If the refresh token is dead, throw 401. 
            // Your React Native app will catch this and force a logout.
            throw new UnauthorizedException('Invalid or expired refresh token');
        }
    }
}