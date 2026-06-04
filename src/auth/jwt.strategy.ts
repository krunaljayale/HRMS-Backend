// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            // 1. Tell Passport exactly where to look for the token (matches your Axios interceptor)
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

            // 2. Reject the token immediately if it has expired
            ignoreExpiration: false,

            // 3. The exact same secret key you will use to create the token (move to .env in production!)
            secretOrKey: process.env.JWT_ACCESS_SECRET || 'super_secret_development_key',
        });
    }

    // 4. If the token is valid, Passport automatically passes the decoded payload here.
    // Whatever you return from this function gets attached to `req.user`.
    async validate(payload: any) {
        return {
            employeeId: payload.sub,
            role: payload.role
        };
    }
}