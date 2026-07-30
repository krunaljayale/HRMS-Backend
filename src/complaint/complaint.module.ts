import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ComplaintService } from './complaint.service';
import { ComplaintAppController } from './complaint.app.controller';
import { Complaint, ComplaintSchema } from './schemas/complaint.schema';
import { EmployeeModule } from '../employee/employee.module';
import { NotificationsModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Complaint.name, schema: ComplaintSchema }]),
    EmployeeModule,
    NotificationsModule,
  ],
  controllers: [ComplaintAppController],
  providers: [ComplaintService],
  exports: [ComplaintService],
})
export class ComplaintModule { }