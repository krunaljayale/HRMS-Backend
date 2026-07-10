import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeeService } from './employee.service';
import { EmployeeWebController } from './employee.web.controller';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { EmployeeAppController } from './employee.app.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { LeaveModule } from '../leave/leave.module';

@Module({
  imports: [
    // This line registers the schema with MongoDB for this specific module
    MongooseModule.forFeature([{ name: Employee.name, schema: EmployeeSchema }]),
    CloudinaryModule,
    forwardRef(() => LeaveModule),
  ],
  controllers: [EmployeeAppController, EmployeeWebController],
  providers: [EmployeeService],
  // We export the service so the AuthModule can use it later to check emails during login
  exports: [EmployeeService],
})
export class EmployeeModule { }