import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeaveLedgerDocument = LeaveLedger & Document;

@Schema({ timestamps: true })
export class LeaveLedger {
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
    employeeId!: Types.ObjectId;

    // Is this a monthly paid leave token, or a Sunday comp-off token?
    @Prop({ required: true, enum: ['Paid', 'CompOff'] })
    leaveType!: string;

    // The current state of this specific token
    @Prop({ required: true, default: 'Active', enum: ['Active', 'Locked', 'Consumed', 'Expired'] })
    status!: string;

    // ── ORIGIN METADATA (Where did this token come from?) ──
    @Prop({ index: true })
    fixedAllowanceMonth?: string; // e.g., "2026-06" (Filled only if leaveType is 'Paid')

    @Prop({ type: Types.ObjectId, ref: 'Attendance' })
    earnedFromAttendanceId?: Types.ObjectId; // Filled only if leaveType is 'CompOff'

    @Prop({ required: true, default: 1 })
    value!: number; // 1 for a Full Day token, 0.5 for a Half Day token

    // ── VOLATILITY ──
    @Prop()
    expiryDate?: Date; // Mandatory for CompOffs (createdAt + 90 days). Null for Paid leaves if they never expire.
}

export const LeaveLedgerSchema = SchemaFactory.createForClass(LeaveLedger);

// Database-level protection against duplicate monthly credits
LeaveLedgerSchema.index(
    { employeeId: 1, leaveType: 1, fixedAllowanceMonth: 1 },
    { unique: true, sparse: true }
);