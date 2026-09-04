import { Injectable, ConflictException, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HrProfile, HrProfileDocument } from './schemas/hr-profile.schema';
import { EmployeeService } from '../employee/employee.service';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from '../employee/dto/change-password.dto';

@Injectable()
export class HrService {
    constructor(
        @InjectModel(HrProfile.name) private hrProfileModel: Model<HrProfileDocument>,
        private employeeService: EmployeeService,
    ) { }

    private async getRawMasterProfile(): Promise<HrProfileDocument> {
        const hrProfile = await this.hrProfileModel.findOne({ isActive: true }).exec();
        if (!hrProfile) {
            throw new NotFoundException('SYSTEM_ERROR: Active Master HR Profile configuration not found.');
        }
        return hrProfile;
    }

    async getMasterProfile(): Promise<any> {
        const hrProfile = await this.getRawMasterProfile();

        // Strict non-sensitive selection parameters to maintain corporate privacy protocols
        const selectFields = 'name employeeCode email department position status';

        // Call your existing method safely
        const employeeData = await this.employeeService.getEmployeeById(
            hrProfile.employeeId.toString(),
            selectFields
        );

        // return {
        //     idCode: hrProfile.idCode,
        //     isActive: hrProfile.isActive,
        //     createdAt: hrProfile.createdAt,
        //     updatedAt: hrProfile.updatedAt,
        //     employeeAccount: {
        //         _id: employeeData._id,
        //         name: employeeData.name,
        //         employeeCode: employeeData.employeeCode,
        //         email: employeeData.email,
        //         department: employeeData.department,
        //         position: employeeData.position,
        //         status: employeeData.status,
        //         role: employeeData.role,
        //     }
        // }

        return {
            idCode: hrProfile.idCode,
            isActive: hrProfile.isActive,
            createdAt: hrProfile.createdAt,
            updatedAt: hrProfile.updatedAt,
            employeeAccount: {
                _id: employeeData._id,
                name: "HR Master Account", // Masking the actual name for privacy
                employeeCode: hrProfile.idCode, // Using idCode as a placeholder for employeeCode
                email: 'hr@infinityarthvishva.com',
                department: 'Human Resources', // Masking the actual department for privacy
                position: 'HR Master', // Masking the actual position for privacy
                status: 'Active', // Assuming the status is active for the master account
                role: 'HR Master', // Masking the actual role for privacy
            }
        }
    }

    async changeMasterPassword(changePasswordDto: ChangePasswordDto) {
        const { oldPassword, newPassword } = changePasswordDto;

        const rawMaster = await this.getRawMasterProfile();

        if (!rawMaster) {
            throw new BadRequestException('Master profile not found.');
        }

        // 1. Fetch the HR profile explicitly requesting the hidden password field
        const hrProfile = await this.hrProfileModel
            .findById(rawMaster._id)
            .select('+password')
            .exec();

        if (!hrProfile) {
            throw new BadRequestException('HR profile not found.');
        }

        // 2. Verify the old password is correct
        const isPasswordValid = await bcrypt.compare(
            oldPassword,
            hrProfile.password,
        );

        if (!isPasswordValid) {
            throw new BadRequestException('Incorrect old password.');
        }

        // 3. Hash the new password manually (since schema pre-save does not handle hashing)
        const salt = await bcrypt.genSalt(10);
        hrProfile.password = await bcrypt.hash(newPassword, salt);

        // 4. Save the document bypassing schema validation while running hooks
        await hrProfile.save({ validateBeforeSave: false });

        // 5. Return success response
        return {
            success: true,
            message: 'Password updated successfully',
        };
    }

    async createSingleHrProfile(employeeId: string, idCode: string) {
        // 1. Check if ANY profile already exists before trying to create one
        const existingProfile = await this.hrProfileModel.findOne();

        if (existingProfile) {
            throw new ConflictException(
                `An HR profile already exists (ID: ${existingProfile.idCode}). You cannot create another.`
            );
        }

        // 2. If the coast is clear, create the one and only HR profile
        const newHr = new this.hrProfileModel({
            employeeId: new Types.ObjectId(employeeId),
            idCode: idCode,
            isActive: true
        });

        return await newHr.save();
    }

    async validatePassword(idCode: string, password: string) {
        const hr = await this.hrProfileModel
            .findOne({ idCode: idCode })
            .select('+password')
            .exec();

        if (!hr) {
            return null;
        }

        if (!hr.password) {
            throw new UnauthorizedException('Profile does not have a password.');
        }

        const isPasswordValid = await bcrypt.compare(password, hr.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        // Strip password hash before returning the document
        hr.password = undefined as any;

        return hr;
    }

}
