import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveService } from './leave.service';
import { LeaveAppController } from './leave.app.controller';
import { LeaveLedger, LeaveLedgerSchema } from './schemas/leave-ledger.schema';
import { LeaveHistory, LeaveHistorySchema } from './schemas/leave-history.schema';
import { EmployeeModule } from '../employee/employee.module';

@Module({
  imports: [
    //  Register BOTH schemas in the same domain module
    MongooseModule.forFeature([
      { name: LeaveHistory.name, schema: LeaveHistorySchema },
      { name: LeaveLedger.name, schema: LeaveLedgerSchema },
    ]),

    EmployeeModule,
  ],
  controllers: [LeaveAppController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule { }