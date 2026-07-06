import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PayrollDocument = Payroll & Document;

// ── SUB-SCHEMAS FOR CLEAN ORGANIZATION ──

@Schema({ _id: false })
export class Earnings {
  @Prop({ required: true, default: 0 })
  basic!: number;

  @Prop({ default: 0 })
  allowances!: number;

  @Prop({ required: true })
  totalGross!: number; // (Total Earnings / totalCycleDays) * paidDays
}

@Schema({ _id: false })
export class Deductions {
  @Prop({ default: 0 })
  professionalTax!: number;

  @Prop({ default: 0 })
  taxDeductedAtSource!: number;

  @Prop({ default: 0 })
  other!: number;

  @Prop({ default: 0 })
  totalDeductions!: number;
}

// ── MAIN PAYROLL SCHEMA ──

@Schema({ timestamps: true })
export class Payroll extends Document {
  // ── IDENTITY ──
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({ required: true })
  employeeCode!: string;

  @Prop()
  employeeName!: string;

  // ── PERIOD ──
  @Prop({ required: true })
  month!: number; // The payout month (e.g., 5 for May)

  @Prop({ required: true })
  year!: number;

  @Prop({ required: true })
  fromDate!: Date;

  @Prop({ required: true })
  toDate!: Date;

  // ── ATTENDANCE AGGREGATES ──
  @Prop({ required: true })
  totalCycleDays!: number; // e.g., 30 or 31 based on the exact cycle

  @Prop({ default: 0 })
  workingDays!: number;

  @Prop({ default: 0 })
  presentDays!: number;

  @Prop({ default: 0 })
  halfDays!: number;

  @Prop({ default: 0 })
  absentDays!: number;

  @Prop({ default: 0 })
  paidLeaves!: number;

  @Prop({ default: 0 })
  unpaidLeaves!: number;

  @Prop({ default: 0 })
  holidays!: number;

  @Prop({ default: 0 })
  weekOffs!: number;

  @Prop({ default: 0 })
  leavesTaken!: number;

  @Prop({ required: true })
  paidDays!: number;

  @Prop({ default: 0 })
  compOffDays!: number;

  @Prop({
    type: [
      {
        date: { type: String },
        type: { type: String },
        value: { type: Number },
      },
    ],
    default: [],
  })
  paidDaysBreakdown!: { date: string; type: string; value: number }[];

  // ── FINANCIALS ──
  @Prop({ type: Earnings, required: true })
  earnings!: Earnings;

  @Prop({ type: Deductions, required: true })
  deductions!: Deductions;

  @Prop({ required: true })
  netSalary!: number; // totalGross - totalDeductions

  // ── STATUS & TRACKING ──
  @Prop({
    enum: ['Draft', 'Processed', 'Paid'],
    default: 'Draft',
    index: true,
  })
  status!: string;

  @Prop()
  paymentDate?: Date;

  @Prop()
  salarySlipUrl?: string;

  @Prop()
  remarks?: string;

  @Prop({ type: Types.ObjectId, ref: 'HumanResource' }) // Assuming HR handles this
  processedBy?: Types.ObjectId;
}

export const PayrollSchema = SchemaFactory.createForClass(Payroll);

// ── UNIQUE CONSTRAINT ──
// One payroll record per employee per payout month/year
PayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
PayrollSchema.index({ month: 1, year: 1, status: 1 });
