import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false }) // Sub-documents don't need their own ID
export class ComplaintTimeline {
    @Prop({ required: true, enum: ['Submitted', 'Acknowledged', 'In Review', 'Resolved', 'Rejected', 'Commented'] })
    action!: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
    actionBy!: Types.ObjectId;

    @Prop({ required: true })
    role!: string;

    @Prop({ default: '' })
    comments!: string;

    @Prop()
    previousStatus!: string;

    @Prop()
    updatedStatus!: string;

    @Prop({ default: Date.now })
    timestamp!: Date;
}

const TimelineSchema = SchemaFactory.createForClass(ComplaintTimeline);

@Schema({ timestamps: true })
export class Complaint extends Document {
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
    employee!: Types.ObjectId;

    @Prop({ required: true, trim: true, maxlength: 200 })
    title!: string;

    @Prop({
        required: true,
        enum: ['Work Environment', 'Harassment', 'Discrimination', 'Management', 'Policy Violation', 'Facilities', 'Other']
    })
    category!: string;

    @Prop({ enum: ['Low', 'Medium', 'High'], default: 'Medium' })
    priority!: string;

    @Prop({ required: true, trim: true, maxlength: 2000 })
    description!: string;

    @Prop({ enum: ['Pending', 'Acknowledged', 'In Review', 'Resolved', 'Rejected'], default: 'Pending' })
    status!: string;

    @Prop({ default: '' })
    directorComments!: string;

    @Prop({ type: [TimelineSchema] })
    timeline!: ComplaintTimeline[];
}

export const ComplaintSchema = SchemaFactory.createForClass(Complaint);

// Indexes
ComplaintSchema.index({ employee: 1, status: 1 });
ComplaintSchema.index({ status: 1, createdAt: -1 });
ComplaintSchema.index({ priority: 1 });