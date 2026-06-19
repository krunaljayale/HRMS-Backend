import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type HrProfileDocument = HrProfile & Document;

@Schema({ timestamps: true })
export class HrProfile {
    @Prop({ required: true, unique: true, trim: true, uppercase: true })
    idCode!: string;

    @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, unique: true })
    employeeId!: Types.ObjectId;

    @Prop({ default: true })
    isActive!: boolean;
}

export const HrProfileSchema = SchemaFactory.createForClass(HrProfile);


HrProfileSchema.pre('save', async function () {
    if (this.isNew) {
        // Count how many HR profiles currently exist
        const count = await (this.constructor as any).countDocuments();

        if (count >= 1) {
            // 2. Simply throw the error instead of returning next(Error)
            throw new Error('SYSTEM_LOCKED: Only one HR Profile is allowed in the entire system.');
        }
    }
});