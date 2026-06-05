import { Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeDocument } from './employee.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UpdateFcmTokenDto } from './dto/update-fcm.dto';
import { GetDirectoryDto } from './dto/get-directory.dto';

@Injectable()
export class EmployeeService {
    constructor(
        @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    ) { }

    async validatePassword(employeeCode: string, plainTextPass: string): Promise<any> {
        // Find the user and EXPLICITLY ask for the hidden password field
        const employee = await this.employeeModel
            .findOne({ employeeCode: employeeCode })
            .select('+password')
            .exec();

        if (!employee) {
            return null; // User not found
        }

        // Compare the typed password with the hashed password in the DB
        const isPasswordValid = await bcrypt.compare(plainTextPass, employee.password);

        if (!isPasswordValid) {
            return null; // Wrong password
        }

        // Strip the password out safely using destructuring before returning
        const { password, ...safeEmployee } = employee.toObject();

        return safeEmployee;
    }

    // ── GET EMPLOYEE BY ID (Optimized with Select) ──
    async getEmployeeById(
        id: string,
        selectFields?: string | Record<string, number | boolean>
    ): Promise<Employee> {

        // 1. Build the base query
        let query = this.employeeModel.findById(id);

        // 2. If specific fields are requested, chain the select method
        if (selectFields) {
            query = query.select(selectFields);
        }

        // 3. Execute the query
        const employee = await query.exec();

        // 4. Hard stop if the user doesn't exist
        if (!employee) {
            throw new NotFoundException(`Employee with ID ${id} not found`);
        }

        return employee;
    }

    // ── UPDATE FCM TOKEN ──
    async updateFcmToken(employeeId: string, fcmData: UpdateFcmTokenDto): Promise<void> {
        const updatedEmployee = await this.employeeModel.findByIdAndUpdate(
            employeeId,
            {
                $set: {
                    fcmToken: fcmData.fcmToken,
                },
            },
            { returnDocument: 'after' }
        );

        if (!updatedEmployee) {
            throw new NotFoundException('Employee not found');
        }
    }

    // ── GET EMPLOYEE DIRECTORY ──
    async getEmployeeDirectory(queryDto: GetDirectoryDto) {
        const { page = 1, limit = 50, search, department, status } = queryDto;

        // 1. Build the query object
        const query: any = {};

        if (status) query.status = status;
        if (department) query.department = { $regex: department, $options: 'i' };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { mobileNumber: { $regex: search, $options: 'i' } },
            ];
        }

        const skip = (page - 1) * limit;

        // 2. Execute parallel queries (Find & Count)
        const [employees, total] = await Promise.all([
            this.employeeModel
                .find(query)
                .select('name email mobileNumber role department position profileImageUrl employeeCode')
                .sort({ name: 1 }) // alphabetical by name
                .skip(skip)
                .limit(limit)
                .lean() // Returns raw JSON objects instead of heavy Mongoose documents
                .exec(),
            this.employeeModel.countDocuments(query).exec(),
        ]);

        // 3. Transform into the minimal, shareable format
        const directoryEntries = employees.map((emp: any) => ({
            name: emp.name,
            role: emp.role,
            department: emp.department,
            phone: emp.mobileNumber,
            email: emp.email,
            profilePhoto: emp.profileImageUrl || null,
            employeeId: emp.employeeCode, // Included as requested in comments
        }));

        // 4. Return the paginated data structure
        return {
            employees: directoryEntries,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

}