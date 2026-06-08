import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeaveHistoryDocument = LeaveHistory & Document;

@Schema({ timestamps: true })
export class LeaveHistory {
    // ── RELATIONAL POINTER ──
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
    employeeId!: Types.ObjectId;

    // ── TRANSACTION DETAILS ──
    @Prop({ required: true, enum: ['Accrual', 'Deduction', 'Adjustment', 'Reset', 'CarryOver'] })
    type!: string;

    @Prop({ required: true, enum: ['Paid', 'CompOff'] })
    leaveType!: string;

    // ── AUDIT MATH ──
    @Prop({ required: true })
    amount!: number;

    @Prop({ required: true })
    previousBalance!: number;

    @Prop({ required: true })
    newBalance!: number;

    // ── COMP-OFF TRACKING ──
    @Prop()
    earnedDate?: Date;

    @Prop()
    expiryDate?: Date;

    @Prop({ default: false })
    isUsed!: boolean;

    @Prop()
    usedDate?: Date;

    // ── METADATA ──
    @Prop()
    remarks?: string;

    @Prop()
    accrualMonthKey?: string;
}

export const LeaveHistorySchema = SchemaFactory.createForClass(LeaveHistory);