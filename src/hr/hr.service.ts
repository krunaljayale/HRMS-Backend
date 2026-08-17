import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
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

        return {
            idCode: hrProfile.idCode,
            isActive: hrProfile.isActive,
            createdAt: hrProfile.createdAt,
            updatedAt: hrProfile.updatedAt,
            employeeAccount: {
                _id: employeeData._id,
                name: employeeData.name,
                employeeCode: employeeData.employeeCode,
                email: employeeData.email,
                department: employeeData.department,
                position: employeeData.position,
                status: employeeData.status,
                role: employeeData.role,
            }
        }
    }

    async changeMasterPassword(changePasswordDto: ChangePasswordDto) {
        const hrProfile = await this.getRawMasterProfile();

        // Pass validation directly down to the pre-existing EmployeeService sequence
        return await this.employeeService.updatePassword(
            hrProfile.employeeId.toString(),
            changePasswordDto
        );
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
            .populate({
                path: 'employeeId',
                select: '+password'
            })
            .exec();

        if (!hr || !hr.employeeId) {
            return null;
        }

        const employee = hr.employeeId as any;

        if (!employee.password) {
            throw new UnauthorizedException('Profile do not have a password.');
        }

        const isPasswordValid = await bcrypt.compare(password, employee.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        employee.password = undefined;

        return hr;
    }

    
}
