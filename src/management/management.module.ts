import { Module } from '@nestjs/common';
import { ManagementService } from './management.service';
import { ManagementController } from './management.controller';
import { EmployeeModule } from '../employee/employee.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';
import { HolidayModule } from '../holiday/holiday.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [
    EmployeeModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    ReimbursementModule,
    HolidayModule,
    AlertModule,
  ],
  controllers: [ManagementController],
  providers: [ManagementService],
})
export class ManagementModule { }
