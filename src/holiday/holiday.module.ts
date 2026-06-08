import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HolidayService } from './holiday.service';
import { HolidayAppController } from './holiday.app.controller';
import { Holiday, HolidaySchema } from './schemas/holiday.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Holiday.name, schema: HolidaySchema }])
  ],
  controllers: [HolidayAppController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule { }