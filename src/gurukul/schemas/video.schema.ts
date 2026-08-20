// video.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export type VideoDocument = Video & Document;

@Schema({ timestamps: true })
export class Video {
    @Prop({ required: true, trim: true })
    title!: string;

    @Prop({ trim: true })
    description!: string;

    // Renamed for better context
    @Prop({ required: true })
    videoUrl!: string;

    // New field to determine which player to use on the frontend
    @Prop({ required: true, enum: ['youtube', 'direct'], default: 'direct' })
    videoType!: 'youtube' | 'direct';

    // Made optional since YouTube links won't have a Cloudinary publicId
    @Prop()
    publicId?: string;

    @Prop()
    duration!: number; // in seconds

    @Prop()
    thumbnail!: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
    createdBy!: Types.ObjectId;

    @Prop({ default: true })
    isActive!: boolean;
}

export const VideoSchema = SchemaFactory.createForClass(Video);
VideoSchema.plugin(mongoosePaginate);
VideoSchema.set('toJSON', {
    transform: (doc, ret) => {
        const finalObject = ret as Record<string, any>;
        delete finalObject.__v;
        return finalObject;
    },
});