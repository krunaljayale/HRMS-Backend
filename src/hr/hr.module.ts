import { Module } from '@nestjs/common';
import { HrService } from './hr.service';
import { HrWebController } from './hr.web.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { HrProfile, HrProfileSchema } from './schemas/hr-profile.schema';
import { EmployeeModule } from '../employee/employee.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ReimbursementModule } from '../reimbursement/reimbursement.module';

@Module({
  imports: [
    // This line registers the schema with MongoDB for this specific module
    MongooseModule.forFeature([{ name: HrProfile.name, schema: HrProfileSchema }]),
    EmployeeModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    ReimbursementModule
  ],
  controllers: [HrWebController],
  providers: [HrService],
  exports: [HrService]
})
export class HrModule { }
