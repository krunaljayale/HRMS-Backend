import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveService } from './leave.service';
import { LeaveAppController } from './leave.controller';
import { LeaveHistory, LeaveHistorySchema } from './schemas/leave.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LeaveHistory.name, schema: LeaveHistorySchema }]),
  ],
  controllers: [LeaveAppController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}