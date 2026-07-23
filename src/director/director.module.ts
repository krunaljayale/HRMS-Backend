import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DirectorService } from './director.service';
import { DirectorWebController } from './director.web.controller';
import { DirectorProfile, DirectorProfileSchema } from './schemas/director.profile.schema';
import { LeaveModule } from '../leave/leave.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DirectorProfile.name, schema: DirectorProfileSchema }]),
    LeaveModule,
  ],
  controllers: [DirectorWebController],
  providers: [DirectorService],
  exports: [DirectorService],
})
export class DirectorModule { }