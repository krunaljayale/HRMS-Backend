// Inside attendance.module.ts
import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { HolidayModule } from '../holiday/holiday.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceSchema } from './schemas/attendance.schema';
import { AttendanceAppController } from './attendance.app.controller';
import { EmployeeModule } from '../employee/employee.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Attendance', schema: AttendanceSchema }]),
    HolidayModule,
    EmployeeModule,
  ],
  controllers: [AttendanceAppController],
  providers: [AttendanceService],
})
export class AttendanceModule { }