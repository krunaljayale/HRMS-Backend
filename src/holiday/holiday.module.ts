import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HolidayService } from './holiday.service';
import { HolidayAppController } from './holiday.app.controller';
import { Holiday, HolidaySchema } from './schemas/holiday.schema';
import { HolidayWebController } from './holiday.web.controller';
import { HrModule } from '../hr/hr.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Holiday.name, schema: HolidaySchema }]),
    forwardRef(() => HrModule),
  ],
  controllers: [HolidayAppController, HolidayWebController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule { }