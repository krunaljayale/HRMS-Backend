import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GurukulService } from './gurukul.service';
import { GurukulAppController } from './gurukul.app.controller';
import { Video, VideoSchema } from './schema/video.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Video.name, schema: VideoSchema }]),
  ],
  controllers: [GurukulAppController],
  providers: [GurukulService],
})
export class GurukulModule { }