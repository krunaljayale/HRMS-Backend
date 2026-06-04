import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeeService } from './employee.service';
import { EmployeeAppController } from './employee.controller';
import { Employee, EmployeeSchema } from './employee.schema';

@Module({
  imports: [
    // This line registers the schema with MongoDB for this specific module
    MongooseModule.forFeature([{ name: Employee.name, schema: EmployeeSchema }]),
  ],
  controllers: [EmployeeAppController],
  providers: [EmployeeService],
  // We export the service so the AuthModule can use it later to check emails during login
  exports: [EmployeeService], 
})
export class EmployeeModule {}