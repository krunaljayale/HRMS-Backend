// src/auth/jwt-auth.guard.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // You can customize the error handling here if you want, 
  // but the default behavior automatically throws a 401 Unauthorized, 
  // which is exactly what your React Native frontend expects to trigger the refresh loop.
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Token is missing or invalid.');
    }
    return user;
  }
}