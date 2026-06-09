import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class WorkflowStep {
    @Prop({ type: Types.ObjectId, ref: 'Employee' })
    approverId?: Types.ObjectId;

    @Prop({ default: false })
    isHRProfileStep!: boolean;

    @Prop({ default: false })
    isDirectorProfileStep!: boolean;

    @Prop({ enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' })
    status!: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee' })
    actedById?: Types.ObjectId;

    @Prop()
    actedAt?: Date;

    @Prop({ trim: true })
    remarks?: string;
}

export const WorkflowStepSchema = SchemaFactory.createForClass(WorkflowStep);