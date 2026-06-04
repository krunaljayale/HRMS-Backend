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

  @Prop()
  buttonLink?: string; // Direct string link to App Store / Play Store

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

  @Prop()
  minimumVersionCode?: number;

  @Prop()
  maximumVersionCode?: number;
}

export const GlobalAlertSchema = SchemaFactory.createForClass(GlobalAlert);