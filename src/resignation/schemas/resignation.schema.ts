import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WorkflowStep, WorkflowStepSchema } from '../../leave/schemas/workflow-step.schema';

export type ResignationDocument = Resignation & Document;

@Schema({ timestamps: true })
export class Resignation {
    // ── APPLICANT ──
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
    employeeId!: Types.ObjectId;

    // ── RESIGNATION DETAILS ──
    @Prop({ required: true, trim: true })
    reason!: string;

    @Prop({ required: true })
    requestedLastWorkingDay!: Date;

    // HR or Director might negotiate a different exit date based on notice period policies
    @Prop()
    approvedLastWorkingDay?: Date;

    // Useful for full-and-final (FnF) settlement calculations later
    @Prop()
    noticePeriodShortfallDays?: number;

    // ── WORKFLOW STATE ──
    @Prop({ type: [WorkflowStepSchema], required: true })
    workflowSteps!: WorkflowStep[];

    @Prop({ default: 0 })
    currentStepIndex!: number;

    // Note: Added 'Withdrawn' so an employee can cancel their resignation if they change their mind
    @Prop({ enum: ['Pending', 'Approved', 'Rejected', 'Withdrawn'], default: 'Pending', index: true })
    overallStatus!: string;
}

export const ResignationSchema = SchemaFactory.createForClass(Resignation);