import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PayrollService } from './payroll.service';
import { PayrollAppController } from './payroll.app.controller';
import { Payroll, PayrollSchema } from './schemas/payroll.schema';
import { EmployeeModule } from '../employee/employee.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';
import { HolidayModule } from '../holiday/holiday.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payroll.name, schema: PayrollSchema }]),
    EmployeeModule,
    AttendanceModule,
    LeaveModule,
    HolidayModule,
    ReimbursementModule,
  ],
  controllers: [PayrollAppController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
