// auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmployeeModule } from '../employee/employee.module';
import { HrModule } from '../hr/hr.module';

@Module({
    imports: [
        PassportModule,
        JwtModule.register({}), // Secrets are handled in the service directly now,
        EmployeeModule,
        HrModule,
    ],
    controllers: [AuthController],
    providers: [JwtStrategy, AuthService],
    exports: [JwtModule, AuthService],
})
export class AuthModule { }