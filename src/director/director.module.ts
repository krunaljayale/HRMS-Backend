import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DirectorService } from './director.service';
import { DirectorWebController } from './director.web.controller';
import { DirectorProfile, DirectorProfileSchema } from './schemas/director.profile.schema';
import { LeaveModule } from '../leave/leave.module';
import { ComplaintModule } from '../complaint/complaint.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DirectorProfile.name, schema: DirectorProfileSchema }]),
    LeaveModule,
    ComplaintModule,
  ],
  controllers: [DirectorWebController],
  providers: [DirectorService],
  exports: [DirectorService],
})
export class DirectorModule { }