// Inside attendance.module.ts
import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { HolidayModule } from '../holiday/holiday.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceSchema } from './schemas/attendance.schema';
import { AttendanceAppController } from './attendance.app.controller';
import { EmployeeModule } from '../employee/employee.module';
import { LeaveModule } from '../leave/leave.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Attendance', schema: AttendanceSchema }]),
    HolidayModule,
    EmployeeModule,
    LeaveModule,
    HolidayModule,
    SystemConfigModule,
  ],
  controllers: [AttendanceAppController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule { }