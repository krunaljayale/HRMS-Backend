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

    @Prop({ required: true })
    cloudinaryUrl!: string;

    @Prop({ required: true })
    publicId!: string;

    @Prop()
    duration!: number; // in seconds

    @Prop()
    thumbnail!: string;

    // References the Employee collection
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
    createdBy!: Types.ObjectId;

    @Prop({ default: true })
    isActive!: boolean;
}

export const VideoSchema = SchemaFactory.createForClass(Video);

// ✅ Attach the pagination plugin
VideoSchema.plugin(mongoosePaginate);

// ✅ Clean JSON response
VideoSchema.set('toJSON', {
    transform: (doc, ret) => {
        // Cast to Record<string, any> to allow deletion
        const finalObject = ret as Record<string, any>;
        delete finalObject.__v;
        return finalObject;
    },
});