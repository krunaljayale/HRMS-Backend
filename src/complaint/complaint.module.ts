import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ComplaintService } from './complaint.service';
import { ComplaintAppController } from './complaint.app.controller';
import { Complaint, ComplaintSchema } from './schemas/complaint.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Complaint.name, schema: ComplaintSchema }]),
  ],
  controllers: [ComplaintAppController],
  providers: [ComplaintService],
})
export class ComplaintModule { }