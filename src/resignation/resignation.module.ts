import { Module } from '@nestjs/common';
import { ResignationService } from './resignation.service';
import { ResignationAppController } from './resignation.app.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { ResignationSchema } from './schemas/resignation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Resignation', schema: ResignationSchema }]),
  ],
  controllers: [ResignationAppController],
  providers: [ResignationService],
})
export class ResignationModule { }
