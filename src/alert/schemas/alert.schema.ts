import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GlobalAlertDocument = GlobalAlert & Document;

@Schema({ timestamps: true })
export class GlobalAlert {
  // ── CONTENT ──
  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop()
  imageUrl?: string;

  @Prop({ default: 'Update Now' })
  buttonText!: string;

  @Prop({ type: { android: String, ios: String }, _id: false })
  buttonLink?: { android?: string; ios?: string };

  @Prop({ default: false })
  isSkippable!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({
    enum: ['force_update', 'optional_update', 'info', 'promo', 'maintenance'],
    default: 'info',
  })
  type!: string;

  // ── TARGETING (Platform & Versioning) ──
  @Prop({ enum: ['android', 'ios', 'both'], required: true, default: 'both' })
  platform!: string;

  // Change from a single number to an object containing both platforms
  @Prop({ type: { android: Number, ios: Number }, _id: false })
  minimumVersionCode?: { android?: number; ios?: number };

  @Prop({ type: { android: Number, ios: Number }, _id: false })
  maximumVersionCode?: { android?: number; ios?: number };
}

export const GlobalAlertSchema = SchemaFactory.createForClass(GlobalAlert);