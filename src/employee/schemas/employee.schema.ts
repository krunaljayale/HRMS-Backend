import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';

export type EmployeeDocument = Employee & Document;

// ── ENUMS FOR STRICT DATA TYPING ──
export const DEPARTMENTS = [
    'Engineering', 'Sales', 'Marketing', 'Finance', 'Operations', 'HR', 'IT', 'Accountant', 'Area Manager', 'Driver', 'Helper', 'Office Boy', 'Wealth Advisor', 'BDM' // Business Development Manager
];

export const POSITIONS = [
    'Intern', 'Junior Developer', 'Software Developer', 'Tester', 'Android Developer', 'iOS Developer', 'App Developer', 'Senior Developer',
    'Manager', 'Director', 'VP', 'General Manager', 'Specialist',
    'HR Executive', 'System Administrator'
];

@Schema({ timestamps: true })
export class Employee extends Document {
    // ── EMPLOYEE CODE ──
    @Prop({ required: true, unique: true, uppercase: true, trim: true, match: /^IA\d{5}$/ })
    employeeCode!: string;

    @Prop({ required: true, select: false })
    password!: string;

    // ── ACCOUNT ACCESS LEVEL ──
    @Prop({ required: true, enum: ['Employee'], default: 'Employee' })
    role!: string;

    // ── TECHNICAL SYSTEM PRIVILEGES ──
    @Prop({ default: false })
    isAppAdmin!: boolean;

    @Prop({ enum: ['Active', 'Inactive'], default: 'Active' })
    status!: string;

    @Prop()
    deactivateReason?: string;

    // ── BASIC DETAILS ──
    @Prop({ required: true, trim: true })
    name!: string;

    @Prop({ required: true, unique: true, lowercase: true, trim: true })
    email!: string;

    @Prop({ required: true, trim: true, index: true })
    mobileNumber!: string;

    @Prop({ trim: true })
    alternateMobileNumber?: string;

    @Prop({ enum: ['Male', 'Female', 'Other'] })
    gender!: string;

    @Prop({ enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] })
    bloodGroup?: string;

    @Prop()
    dateOfBirth?: Date;

    @Prop({ enum: ['Single', 'Married', 'Divorced', 'Widowed'] })
    maritalStatus?: string;

    @Prop()
    profileImageUrl?: string;

    @Prop({ type: [Number] })
    faceDescriptor?: number[];

    // ── PERSONAL DETAILS ──
    @Prop({ trim: true })
    fatherName?: string;

    @Prop({ trim: true })
    motherName?: string;

    @Prop()
    currentAddress?: string;

    @Prop()
    permanentAddress?: string;

    @Prop()
    district?: string;

    @Prop()
    state?: string;

    @Prop()
    pincode?: string;

    // ── JOB DETAILS ──
    @Prop()
    joiningDate?: Date;

    @Prop({ trim: true })
    department?: string;

    @Prop({ trim: true })
    position?: string;

    @Prop({ type: Boolean, default: false })
    isLeadershipRole!: boolean;

    @Prop()
    salary?: number;

    // ── PAYROLL POLICY ──
    @Prop({
        type: {
            basicPercentage: { type: Number, default: 100 },
            allowancePercentage: { type: Number, default: 0 }
        },
        default: { basicPercentage: 100, allowancePercentage: 0 }
    })
    salaryStructure!: { basicPercentage: number; allowancePercentage: number };

    // ── DIRECT REPORTING SUPERVISOR ──
    @Prop({ type: Types.ObjectId, ref: 'Employee', index: true })
    managerId?: Types.ObjectId;

    // ── EXPERIENCE ──
    @Prop({ enum: ['Fresher', 'Experienced'] })
    experienceType?: string;

    @Prop()
    totalExperienceYears?: number;

    @Prop()
    lastCompanyName?: string;

    @Prop()
    experienceCertificateUrl?: string;

    // ── EDUCATION ──
    @Prop()
    hscPercent?: number;

    @Prop()
    graduationCourse?: string;

    @Prop()
    graduationPercent?: number;

    @Prop()
    postGraduationCourse?: string;

    @Prop()
    postGraduationPercent?: number;

    // ── DOCS ──
    @Prop()
    aadhaarNumber?: string;

    @Prop()
    panNumber?: string;

    @Prop()
    aadhaarFileUrl?: string;

    @Prop()
    panFileUrl?: string;

    @Prop()
    passbookFileUrl?: string;

    @Prop()
    tenthMarksheetUrl?: string;

    @Prop()
    twelfthMarksheetUrl?: string;

    @Prop()
    graduationMarksheetUrl?: string;

    @Prop()
    postGraduationMarksheetUrl?: string;

    @Prop()
    medicalDocumentUrl?: string;

    // ── BANK DETAILS ──
    @Prop()
    accountHolderName?: string;

    @Prop()
    bankName?: string;

    @Prop()
    accountNumber?: string;

    @Prop()
    ifsc?: string;

    @Prop()
    branch?: string;

    @Prop({ default: false })
    bankVerified!: boolean;

    @Prop()
    bankVerifiedDate?: Date;


    // ── VERIFICATION ──
    @Prop({ default: false })
    aadhaarVerified!: boolean;

    @Prop({ default: false })
    panVerified!: boolean;

    @Prop()
    aadhaarVerifiedDate?: Date;

    @Prop()
    panVerifiedDate?: Date;

    // ── EMERGENCY CONTACT ──
    @Prop()
    emergencyContactName?: string;

    @Prop()
    emergencyContactRelationship?: string;

    @Prop()
    emergencyContactMobile?: string;

    @Prop()
    emergencyContactAddress?: string;

    // ── HEALTH ──
    @Prop({ enum: ['Yes', 'No'], default: 'No' })
    hasDisease!: string;

    @Prop()
    diseaseName?: string;

    @Prop()
    diseaseType?: string;

    @Prop()
    diseaseSince?: string;

    @Prop()
    medicinesRequired?: string;

    @Prop()
    doctorName?: string;

    @Prop()
    doctorContact?: string;

    // ── LEAVE BALANCES ──
    @Prop({ default: 0 })
    compOffBalance!: number;

    @Prop({ default: 0 })
    paidLeaveBalance!: number;

    @Prop()
    lastLeaveAccrualDate?: Date;

    @Prop()
    lastWorkingDate?: Date;

    // ── REFRESH & NOTIFICATIONS ──
    @Prop()
    refreshToken?: string;

    @Prop()
    fcmToken?: string;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);

// ── HASH PASSWORD HOOK ──
EmployeeSchema.pre<EmployeeDocument>('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});