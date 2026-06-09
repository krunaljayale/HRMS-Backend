import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

// ── SUB-SCHEMA 1: LOCATION TRACKING ──
@Schema({ _id: false })
export class LocationHistory {
    @Prop({ required: true })
    latitude!: number;

    @Prop({ required: true })
    longitude!: number;

    @Prop({ default: Date.now })
    timestamp!: Date;
}
const LocationHistorySchema = SchemaFactory.createForClass(LocationHistory);

// ── SUB-SCHEMA 2: THE "PROPOSED STATE" (CORRECTION REQUEST) ──
@Schema({ _id: false })
export class CorrectionRequestData {
    @Prop()
    requestedInTime?: Date;

    @Prop()
    requestedOutTime?: Date;

    @Prop({ enum: ['P', 'Half', 'Coff', 'A'] })
    requestedStatus?: string;

    @Prop({ required: true, trim: true })
    reason!: string;

    @Prop()
    proofUrl?: string;

    @Prop({ default: Date.now })
    requestedOn!: Date;
}
const CorrectionRequestDataSchema = SchemaFactory.createForClass(CorrectionRequestData);

// ── SUB-SCHEMA 3: CORRECTION AUDIT TRAIL ──
@Schema({ _id: false })
export class CorrectionHistory {
    @Prop({ enum: ['Requested', 'Approved', 'Rejected'], required: true })
    action!: string;

    @Prop({ required: true })
    byRole!: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee' })
    byEmployeeId!: Types.ObjectId;

    @Prop()
    remark!: string;

    @Prop({ default: Date.now })
    timestamp!: Date;
}
const CorrectionHistorySchema = SchemaFactory.createForClass(CorrectionHistory);

// ════════════════════════════════════════════════════════════════
// ── MAIN ATTENDANCE SCHEMA ──
// ════════════════════════════════════════════════════════════════
@Schema({ timestamps: true })
export class Attendance extends Document { // Extends Document for _id typings

    // ── IDENTITY ──
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
    employeeId!: Types.ObjectId;

    @Prop({ required: true, uppercase: true, index: true })
    employeeCode!: string;

    @Prop()
    employeeName!: string;

    // 🛡️ Stored as YYYY-MM-DD string to prevent IST/UTC timezone shift bugs
    @Prop({ required: true, index: true })
    date!: string;

    // ── TIMES ──
    @Prop()
    inTime?: Date;

    @Prop()
    outTime?: Date;

    @Prop()
    totalHours?: number;

    @Prop()
    totalMinutes?: number;

    // ── STATUS ──
    @Prop({
        enum: ['P', 'A', 'WO', 'L', 'CompOff', 'AUTO', 'H', 'Half'],
        default: 'P',
    })
    status!: string;

    @Prop({ default: false })
    isLate!: boolean;

    @Prop({ default: 0 })
    lateMinutes?: number;

    // ── GEO ATTENDANCE ──
    @Prop({ default: false })
    isGeoAttendance!: boolean;

    @Prop({ enum: ['Office', 'Field', 'WFH'], default: 'Office' })
    workMode!: string;

    @Prop()
    checkInLatitude?: number;

    @Prop()
    checkInLongitude?: number;

    @Prop()
    checkOutLatitude?: number;

    @Prop()
    checkOutLongitude?: number;

    @Prop({ type: [LocationHistorySchema], default: [] })
    locationHistory?: LocationHistory[];

    // ── CORRECTIONS (Refactored) ──
    @Prop({ default: false })
    correctionRequested?: boolean;

    @Prop({
        enum: [
            'None',
            'Pending_HR',
            'Pending_GM',
            'Pending_VP',
            'Pending_Director',
            'Approved',
            'Rejected',
        ],
        default: 'None',
    })
    correctionStatus?: string;

    //  The clean envelope for pending requests
    @Prop({ type: CorrectionRequestDataSchema })
    activeCorrectionRequest?: CorrectionRequestData;

    @Prop({ type: [CorrectionHistorySchema], default: [] })
    correctionHistory?: CorrectionHistory[];

    // ── REPORTS ──
    @Prop()
    todayWork?: string;

    @Prop()
    pendingWork?: string;

    @Prop()
    issuesFaced?: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee', index: true })
    reportParticipant!: Types.ObjectId;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'Employee' }], default: [] })
    reportReadBy?: Types.ObjectId[];
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

// ── UNIQUE CONSTRAINT ──
// One record per employee per calendar day. 
AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });