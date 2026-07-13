import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReimbursementDocument = Reimbursement & Document;

@Schema({ timestamps: true })
export class Reimbursement extends Document {
    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
    employeeId!: Types.ObjectId;

    @Prop({ required: true })
    amount!: number;

    @Prop({ required: true })
    reason!: string;

    @Prop({ required: true })
    expenseDate!: Date; // When the expense occurred

    @Prop()
    imageProofUrl?: string;

    // HR Approval Status
    @Prop({
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
        index: true
    })
    hrStatus!: string;

    @Prop()
    rejectionReason?: string;

    // Payment Tracking
    @Prop({
        enum: ['Unpaid', 'Paid'],
        default: 'Unpaid',
        index: true
    })
    paymentStatus!: string;

    // The specific payroll document this was disbursed with
    @Prop({ type: Types.ObjectId, ref: 'Payroll', index: true })
    payrollId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'HumanResource' })
    processedBy?: Types.ObjectId;
}

export const ReimbursementSchema = SchemaFactory.createForClass(Reimbursement);