import { forwardRef, Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { HrWebController } from './hr.web.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { HrProfile, HrProfileSchema } from './schemas/hr-profile.schema';
import { EmployeeModule } from '../employee/employee.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';
import { ComplaintModule } from '../complaint/complaint.module';
import { HolidayModule } from '../holiday/holiday.module';
import { AlertModule } from '../alert/alert.module';
import { GurukulModule } from '../gurukul/gurukul.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: HrProfile.name, schema: HrProfileSchema }]),
    EmployeeModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    ReimbursementModule,
    ComplaintModule,
    forwardRef(() => AlertModule),
    forwardRef(() => HolidayModule),
    forwardRef(() => GurukulModule),
  ],
  controllers: [HrWebController],
  providers: [HrService],
  exports: [HrService]
})
export class HrModule { }