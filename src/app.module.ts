import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeeModule } from './employee/employee.module';
import { LeaveModule } from './leave/leave.module';
import { AlertModule } from './alert/alert.module';
import { AuthModule } from './auth/auth.module';
import { GurukulModule } from './gurukul/gurukul.module';
import { ComplaintModule } from './complaint/complaint.module';
import { HolidayModule } from './holiday/holiday.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { ResignationModule } from './resignation/resignation.module';
import { HrModule } from './hr/hr.module';
import { NotificationsModule } from './notification/notification.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { ReimbursementModule } from './reimbursement/reimbursement.module';
import { DirectorModule } from './director/director.module';
import { ManagementModule } from './management/management.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // 1. Initialize the Config Module to be globally available
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Initialize Mongoose asynchronously using the Config Service
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),

    ScheduleModule.forRoot(),

    EmployeeModule,

    LeaveModule,

    AlertModule,

    AuthModule,

    GurukulModule,

    ComplaintModule,

    HolidayModule,

    AttendanceModule,

    PayrollModule,

    SystemConfigModule,

    ResignationModule,

    HrModule,

    NotificationsModule,

    CloudinaryModule,

    ReimbursementModule,

    DirectorModule,

    ManagementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }