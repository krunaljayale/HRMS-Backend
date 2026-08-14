import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveService } from './leave.service';
import { LeaveAppController } from './leave.app.controller';
import { LeaveLedger, LeaveLedgerSchema } from './schemas/leave-ledger.schema';
import { LeaveHistory, LeaveHistorySchema } from './schemas/leave-history.schema';
import { EmployeeModule } from '../employee/employee.module';
import { NotificationsModule } from '../notification/notification.module';
import { LeaveWebController } from './leave.web.controller';

@Module({
  imports: [
    //  Register BOTH schemas in the same domain module
    MongooseModule.forFeature([
      { name: LeaveHistory.name, schema: LeaveHistorySchema },
      { name: LeaveLedger.name, schema: LeaveLedgerSchema },
    ]),

    forwardRef(() => EmployeeModule),
    NotificationsModule,
  ],
  controllers: [LeaveAppController,LeaveWebController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule { }