import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WorkflowStep, WorkflowStepSchema } from './workflow-step.schema';

// ── MAIN LEAVE HISTORY SCHEMA ──
export type LeaveHistoryDocument = LeaveHistory & Document;

@Schema({ timestamps: true })
export class LeaveHistory {
    // ── APPLICANT ──
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
    employeeId!: Types.ObjectId;

    // ── LEAVE DETAILS ──
    @Prop({ required: true, enum: ['Paid', 'Casual', 'Sick', 'Unpaid', 'CompOff', 'Other'] })
    leaveCategory!: string;

    @Prop({ required: true })
    startDate!: Date;

    @Prop({ required: true })
    endDate!: Date;

    @Prop({ required: true })
    totalDays!: number;

    @Prop({ default: false })
    isHalfDay!: boolean;

    @Prop({ enum: ['Morning', 'Afternoon', ''] })
    halfDayPeriod?: string;

    @Prop({ required: true, trim: true })
    reason!: string;

    // ── WORKFLOW STATE ──
    @Prop({ type: [WorkflowStepSchema], required: true })
    workflowSteps!: WorkflowStep[];

    @Prop({ default: 0 })
    currentStepIndex!: number;

    @Prop({ enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'], default: 'Pending', index: true })
    overallStatus!: string;

    // ── LEDGER JUSTIFICATION ──
    @Prop({ type: [{ type: Types.ObjectId, ref: 'LeaveLedger' }] })
    consumedLedgerIds?: Types.ObjectId[];
}

export const LeaveHistorySchema = SchemaFactory.createForClass(LeaveHistory);