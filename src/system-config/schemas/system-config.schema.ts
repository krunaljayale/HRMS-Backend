import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SystemConfigDocument = SystemConfig & Document;

@Schema({ timestamps: true })
export class SystemConfig {
  @Prop({ required: true, default: 18.5339582 })
  officeLat!: number;

  @Prop({ required: true, default: 73.839535 })
  officeLon!: number;

  @Prop({ required: true, default: 50 })
  radiusMeters!: number;

  @Prop({ required: true, default: 8.5 })
  defaultShiftHours!: number;

  @Prop({ required: true, default: 7.0 })
  saturdayShiftHours!: number;
}

export const SystemConfigSchema = SchemaFactory.createForClass(SystemConfig);