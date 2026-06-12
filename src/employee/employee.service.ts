import { Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import { Model, Types } from 'mongoose';
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

    async getUpcomingBirthdays() {
        // 1. Calculate the target dates
        const today = new Date();

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(today.getDate() + 2);

        // 2. Map them into an array for easy matching
        const targetDates = [
            { label: 'today', month: today.getMonth() + 1, day: today.getDate() },
            { label: 'tomorrow', month: tomorrow.getMonth() + 1, day: tomorrow.getDate() },
            { label: 'dayAfter', month: dayAfterTomorrow.getMonth() + 1, day: dayAfterTomorrow.getDate() }
        ];

        // 3. Build the MongoDB $or array dynamically
        const matchConditions = targetDates.map(d => ({
            birthMonth: d.month,
            birthDay: d.day
        }));

        // 4. Run the Aggregation Pipeline
        const employees = await this.employeeModel.aggregate([
            {
                $match: {
                    status: 'Active',
                    dateOfBirth: { $exists: true } // Removed strict $type check
                }
            },
            {
                //  NEW STAGE: Safely parse Strings into Dates on the fly
                $addFields: {
                    parsedDOB: { $toDate: '$dateOfBirth' }
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    employeeCode: 1,
                    profileImageUrl: 1,
                    department: 1,
                    dateOfBirth: 1,
                    //  Use the parsedDOB for calculations
                    birthMonth: { $month: '$parsedDOB' },
                    birthDay: { $dayOfMonth: '$parsedDOB' }
                }
            },
            {
                $match: {
                    $or: matchConditions
                }
            }
        ]);

        // 5. Initialize the structured return object
        const result = {
            today: [] as any[],
            tomorrow: [] as any[],
            upcoming: [] as any[]
        };

        // 6. Group the results
        employees.forEach(emp => {
            if (emp.birthMonth === targetDates[0].month && emp.birthDay === targetDates[0].day) {
                result.today.push(emp);
            } else if (emp.birthMonth === targetDates[1].month && emp.birthDay === targetDates[1].day) {
                result.tomorrow.push(emp);
            } else {
                result.upcoming.push(emp);
            }

            // Clean up the temporary aggregation fields before sending to frontend
            delete emp.birthMonth;
            delete emp.birthDay;
        });

        return result;
    }

    async addFaceDescriptor(employeeId: string, faceDescriptors: number[][], imageBase64: string): Promise<void> {

        // Note: If you have an AWS S3 or Cloudinary service, you should upload the `imageBase64` 
        // here and get a standard HTTPS URL back so your MongoDB doesn't get bloated with Base64 strings.
        // Example: const imageUrl = await this.s3Service.uploadBase64(imageBase64);
        const imageUrl = imageBase64;

        const updatedEmployee = await this.employeeModel.findByIdAndUpdate(
            employeeId,
            {
                $set: {
                    faceDescriptors: faceDescriptors, // Save the array of arrays
                    // profileImageUrl: imageUrl,        // Automatically update their profile pic
                },
            },
            { new: true } // Return the updated document
        );

        if (!updatedEmployee) {
            throw new NotFoundException('Employee not found');
        }
    }
}