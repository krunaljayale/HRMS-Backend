import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { DirectorProfile, DirectorProfileDocument } from './schemas/director.profile.schema';

@Injectable()
export class DirectorService {

    constructor(
        @InjectModel(DirectorProfile.name) private directorProfileModel: Model<DirectorProfileDocument>,
    ) { }

    async validatePassword(idCode: string, password: string) {

        const director = await this.directorProfileModel
            .findOne({ idCode: idCode })
            .exec();

        if (!director) {
            return null;
        }

        if (!director.password) {
            throw new UnauthorizedException('Profile does not have a password.');
        }

        // Compare directly against the director's hashed password
        const isPasswordValid = await bcrypt.compare(password, director.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        // Remove the password from the returned object for security
        director.password = undefined as any;

        return director;
    }

    async getSystemDirectorProfile(directorId: string): Promise<any> {
        // Fetch the profile but exclude the password hash
        const profile = await this.directorProfileModel.findById(directorId).select('-password');

        if (!profile) {
            throw new NotFoundException('Director profile not found');
        }

        // Return exactly what the schema holds, with no 'employeeAccount' wrapper
        return {
            idCode: profile.idCode,
            isActive: profile.isActive,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            // Explicitly pass null for employeeAccount so the frontend hook doesn't break if shared
            employeeAccount: null
        };
    }

    async changeDirectorPassword(directorId: string, changePasswordDto: any) {
        const { oldPassword, newPassword } = changePasswordDto;

        // 1. Fetch the specific Director profile
        const profile = await this.directorProfileModel.findById(directorId);

        if (!profile) {
            throw new NotFoundException('Director profile not found');
        }

        // 2. Verify the old password matches the currently stored hash
        const isPasswordValid = await bcrypt.compare(oldPassword, profile.password);

        if (!isPasswordValid) {
            throw new BadRequestException('The current password provided is incorrect.');
        }

        // 3. Assign the new plain-text password to the document
        profile.password = newPassword;

        // 4. Save the document. 
        // ⚠️ This will automatically trigger your DirectorProfileSchema.pre('save') hook 
        // which will securely hash 'this.password' before it hits the database.
        await profile.save();

        return {
            success: true,
            message: 'Director security matrix updated successfully',
        };
    }
}