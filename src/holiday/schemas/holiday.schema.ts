import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Holiday extends Document {
  @Prop({ required: true, index: true })
  date!: Date;

  @Prop({ required: true, index: true }) // Extracted automatically for fast frontend querying
  year!: number;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ 
    required: true, 
    enum: ['National', 'Company-specific'], 
    default: 'National' 
  })
  type!: string;

  @Prop({ trim: true })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ default: true, index: true }) // Soft Delete flag
  isActive!: boolean;
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);

// Compound index to prevent exact duplicates on the same day
HolidaySchema.index({ date: 1, name: 1 }, { unique: true });