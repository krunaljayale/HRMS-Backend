import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AlertService } from './alert.service';
import { AlertAppController } from './alert.app.controller';
import { GlobalAlert, GlobalAlertSchema } from './alert.schema';
import { AlertWebController } from './alert.web.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: GlobalAlert.name, schema: GlobalAlertSchema }]),
  ],
  controllers: [AlertAppController, AlertWebController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule { }