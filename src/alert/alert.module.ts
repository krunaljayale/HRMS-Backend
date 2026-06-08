import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AlertService } from './alert.service';
import { AlertAppController } from './alert.app.controller';
import { GlobalAlert, GlobalAlertSchema } from './schemas/alert.schema';
import { AlertWebController } from './alert.web.controller';
import { EmployeeModule } from '../employee/employee.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: GlobalAlert.name, schema: GlobalAlertSchema }]),
    EmployeeModule
  ],
  controllers: [AlertAppController, AlertWebController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule { }