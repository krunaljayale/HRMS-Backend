import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReimbursementService } from './reimbursement.service';
import { ReimbursementAppController } from './reimbursement.app.controller';
import { Reimbursement, ReimbursementSchema } from './schemas/reimbursement.schema';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EmployeeModule } from '../employee/employee.module';
import { ReimbursementWebController } from './reimbursement.web.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reimbursement.name, schema: ReimbursementSchema },
    ]),
    CloudinaryModule,
    EmployeeModule,
  ],
  controllers: [ReimbursementAppController, ReimbursementWebController],
  providers: [ReimbursementService],
  exports: [ReimbursementService],
})
export class ReimbursementModule { }