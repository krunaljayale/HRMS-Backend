import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReimbursementService } from './reimbursement.service';
import { ReimbursementAppController } from './reimbursement.app.controller';
import { Reimbursement, ReimbursementSchema } from './schemas/reimbursement.schema';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EmployeeModule } from '../employee/employee.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reimbursement.name, schema: ReimbursementSchema },
    ]),
    CloudinaryModule,
    EmployeeModule,
  ],
  controllers: [ReimbursementAppController],
  providers: [ReimbursementService],
  exports: [ReimbursementService],
})
export class ReimbursementModule { }