import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GurukulService } from './gurukul.service';
import { GurukulAppController } from './gurukul.app.controller';
import { Video, VideoSchema } from './schemas/video.schema';
import { HrModule } from '../hr/hr.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Video.name, schema: VideoSchema }]),
    forwardRef(() => HrModule),
  ],
  controllers: [GurukulAppController],
  providers: [GurukulService],
  exports: [GurukulService], 
})
export class GurukulModule { }