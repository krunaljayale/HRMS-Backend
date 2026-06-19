import { Injectable, ConflictException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HrProfile, HrProfileDocument } from './schemas/hr-profile.schema';
import { EmployeeService } from '../employee/employee.service';
import * as bcrypt from 'bcrypt';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';

@Injectable()
export class HrService {
    constructor(
        @InjectModel(HrProfile.name) private hrProfileModel: Model<HrProfileDocument>,
        private employeeService: EmployeeService,
        private attendanceService: AttendanceService,
        private readonly leaveService: LeaveService,
    ) { }

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

    async getGeneralStats() {
        try {
            // 1. Fetch metrics in parallel
            const [totalEmployees, totalPresent, totalOnLeave] = await Promise.all([
                this.employeeService.countAllEmployees(),
                this.attendanceService.getTodayPresentCount(),
                this.leaveService.getTodayApprovedLeavesCount(),
            ]);

            // 2. Real-time Math calculation for Absentees
            // An employee is absent if they are Active, but not Present, and not on an Approved Leave.
            const calculatedAbsent = totalEmployees - totalPresent - totalOnLeave;
            const finalAbsent = calculatedAbsent > 0 ? calculatedAbsent : 0; // Safeguard against negative numbers

            return [
                {
                    title: 'Total Employees',
                    value: String(totalEmployees || 0),
                },
                {
                    title: 'Today Present',
                    value: String(totalPresent || 0),
                },
                {
                    title: 'Today Absent',
                    value: String(finalAbsent),
                },
                {
                    title: 'Today Leave',
                    value: String(totalOnLeave || 0),
                },
            ];
        } catch (error) {
            console.error('Failed to aggregate general stats:', error);
            throw new InternalServerErrorException('Failed to retrieve dashboard statistics');
        }
    }
}