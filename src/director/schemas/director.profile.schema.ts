import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as bcrypt from 'bcrypt';

export type DirectorProfileDocument = DirectorProfile & Document;

@Schema({ timestamps: true })
export class DirectorProfile {
    @Prop({ required: true, unique: true, trim: true, uppercase: true })
    idCode!: string;

    @Prop({ required: true })
    password!: string;

    @Prop({ default: true })
    isActive!: boolean;

    // ── TYPE HINTS FOR TYPESCRIPT COMPILER ──
    createdAt!: Date;
    updatedAt!: Date;
}

export const DirectorProfileSchema = SchemaFactory.createForClass(DirectorProfile);

// ── HASH PASSWORD HOOK ──
DirectorProfileSchema.pre<DirectorProfileDocument>('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// ── ONE PROFILE LIMIT HOOK ──
DirectorProfileSchema.pre('save', async function () {
    if (this.isNew) {
        // Count how many Director profiles currently exist
        const count = await (this.constructor as any).countDocuments();

        if (count >= 1) {
            throw new Error('SYSTEM_LOCKED: Only one Director Profile is allowed in the entire system.');
        }
    }
});