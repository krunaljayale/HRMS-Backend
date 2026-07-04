import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UpdateFcmTokenDto } from './dto/update-fcm.dto';
import { GetDirectoryDto } from './dto/get-directory.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class EmployeeService {
    constructor(
        @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
        private readonly cloudinaryService: CloudinaryService,
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

    async updatePassword(employeeID: string, changePasswordDto: ChangePasswordDto) {
        const { oldPassword, newPassword } = changePasswordDto;

        // 1. Find the user by ID and explicitly request the hidden password field
        const employee = await this.employeeModel
            .findById(employeeID)
            .select('+password')
            .exec();

        if (!employee) {
            throw new BadRequestException('User not found.');
        }

        // 2. Verify the old password is correct
        const isPasswordValid = await bcrypt.compare(oldPassword, employee.password);

        if (!isPasswordValid) {
            throw new BadRequestException('Incorrect old password.');
        }

        // 3. Assign the RAW new password (The pre-save hook handles the hashing)
        employee.password = newPassword;

        // 4. Save the document
        await employee.save();

        // 5. Return success response
        return {
            success: true,
            message: 'Password updated successfully'
        };
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

    async countAllEmployees(): Promise<number> {
        return await this.employeeModel.countDocuments({ status: 'Active' });
    }

    async getDepartmentWiseCount(): Promise<{ label: string; value: number }[]> {
        try {
            const result = await this.employeeModel.aggregate([
                // 1. Only count employees who are currently Active
                { $match: { status: 'Active' } },

                // 2. Group them by their 'department' field
                {
                    $group: {
                        _id: '$department',
                        value: { $sum: 1 },
                    },
                },

                // 3. Format the output to match the React frontend interface
                {
                    $project: {
                        // If the department field is null/missing, label it 'Unassigned'
                        label: { $ifNull: ['$_id', 'Unassigned'] },
                        value: 1,
                        _id: 0,
                    },
                },

                // 4. Sort so the largest departments show up first
                { $sort: { value: -1 } },
            ]);

            return result;
        } catch (error) {
            console.error('Database getDepartmentWiseCount failure:', error);
            throw new InternalServerErrorException('Failed to calculate department statistics');
        }
    }

    async getRecentHires() {
        try {
            // 1. Use aggregation to unify the dates before sorting
            const recentDocs = await this.employeeModel.aggregate([
                // Filter for active employees
                { $match: { status: 'Active' } },

                // Create a temporary 'targetDate' field. 
                // If joiningDate exists, use it. Otherwise, use createdAt.
                {
                    $addFields: {
                        targetDate: { $ifNull: ['$joiningDate', '$createdAt'] }
                    }
                },

                // Sort strictly by our newly computed targetDate, descending (newest first)
                { $sort: { targetDate: -1 } },

                // Grab only the top 5
                { $limit: 5 }
            ]);

            // 2. Map the plain objects returned by the aggregation
            return recentDocs.map((emp) => {
                // Aggregation returns plain JavaScript objects, so we ensure the date is safely parsed
                const finalDate = new Date(emp.targetDate);

                const formattedDate = new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                }).format(finalDate);

                return {
                    id: emp._id.toString(),
                    name: emp.name || 'New Employee',
                    role: emp.position || 'Unassigned',
                    joinDate: formattedDate,
                    avatar: emp.profileImageUrl || '',
                };
            });
        } catch (error) {
            console.error('Database getRecentHires failure:', error);
            throw new InternalServerErrorException('Failed to retrieve recent hires');
        }
    }

    async getAllEmployeesForHR(search?: string, department?: string, status?: string, page: number = 1, limit: number = 10) {
        const query: any = {};

        // 1. Apply exact match filters
        if (department) query.department = department;
        if (status) query.status = status;

        // 2. Apply search filter
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { employeeCode: { $regex: search, $options: 'i' } }
            ];
        }

        // 3. Calculate skip value
        const skip = (page - 1) * limit;

        // 4. Run Count and Find in parallel for better performance
        const [employees, totalRecords] = await Promise.all([
            this.employeeModel
                .find(query)
                .select('employeeCode name email department position status profileImageUrl managerId')
                .populate('managerId', 'name')
                .sort({ employeeCode: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            this.employeeModel.countDocuments(query)
        ]);

        // 5. Map the data
        const data = employees.map((emp: any) => ({
            _id: emp._id.toString(),
            employeeCode: emp.employeeCode,
            name: emp.name,
            email: emp.email,
            department: emp.department,
            position: emp.position,
            status: emp.status,
            profileImageUrl: emp.profileImageUrl,
            managerName: emp.managerId?.name || undefined,
        }));

        // 6. Return structured response with Meta
        return {
            data,
            meta: {
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: page,
                limit
            }
        };
    }

    async getLeadership(): Promise<{ _id: string; name: string; employeeCode: string }[]> {
        const managers = await this.employeeModel.find({ isLeadershipRole: true, status: 'Active' })
            .select('name employeeCode')
            .sort({ employeeCode: 1 })
            .lean();

        return managers.map(manager => ({
            _id: manager._id.toString(),
            name: manager.name,
            employeeCode: manager.employeeCode
        }));
    }

    async generateNewEmployeeCode(): Promise<string> {
        // 1. Find the employee with the highest employeeCode, excluding the Play Store account
        const lastEmployee = await this.employeeModel
            .findOne({
                employeeCode: {
                    $regex: /^IA\d{5}$/,
                    $ne: 'IA11111' // Exclude the Play Store account from the sequence calculation
                }
            })
            .sort({ employeeCode: -1 }) // Sort descending to get the highest legitimate code
            .select('employeeCode')
            .lean();

        // 2. Fallback to 1 if no employee exists yet
        let nextNumericId = 1;

        if (lastEmployee && lastEmployee.employeeCode) {
            // Extract the numeric part (e.g., "IA00141" -> "00141")
            const numericPart = lastEmployee.employeeCode.replace('IA', '');

            // Parse it to a number, then increment it by 1
            nextNumericId = parseInt(numericPart, 10) + 1;
        }

        // 3. Format back to "IA" followed by 5 digits padded with leading zeros
        const newEmployeeCode = `IA${String(nextNumericId).padStart(5, '0')}`;

        return newEmployeeCode;
    }

    async createEmployeeProfile(rawData: any, files: Record<string, Express.Multer.File[]>) {
        const uploadedUrls: Record<string, string> = {};

        // 1. Process files uploading to Cloudinary concurrently
        if (files && Object.keys(files).length > 0) {
            const uploadPromises = Object.keys(files).map(async (fieldKey) => {
                const fileArray = files[fieldKey];
                if (fileArray && fileArray[0]) {
                    try {
                        const uploadResult = await this.cloudinaryService.uploadFile(
                            fileArray[0],
                            `new_hrms_employees_data/${rawData.employeeCode || 'unassigned'}`
                        );
                        uploadedUrls[fieldKey] = uploadResult.secure_url;
                    } catch (error) {
                        console.error(`Failed to upload ${fieldKey} to Cloudinary:`, error);
                        throw new BadRequestException(`File upload failed for ${fieldKey}`);
                    }
                }
            });

            await Promise.all(uploadPromises);
        }

        // 2. Typecast multi-part form strings back to native JS types safely
        const sanitizedData = {
            ...rawData,
            isAppAdmin: rawData.isAppAdmin === 'true',
            isLeadershipRole: rawData.isLeadershipRole === 'true',
            salary: rawData.salary ? Number(rawData.salary) : 0,
            fixedAllowance: rawData.fixedAllowance ? Number(rawData.fixedAllowance) : 0,
            totalExperienceYears: rawData.totalExperienceYears ? Number(rawData.totalExperienceYears) : 0,
            hscPercent: rawData.hscPercent ? Number(rawData.hscPercent) : 0,
            graduationPercent: rawData.graduationPercent ? Number(rawData.graduationPercent) : 0,
            postGraduationPercent: rawData.postGraduationPercent ? Number(rawData.postGraduationPercent) : 0,
            diseaseSince: rawData.diseaseSince ? Number(rawData.diseaseSince) : undefined,

            // 3. Attach file URLs directly onto the data structure maps
            profileImageUrl: uploadedUrls.profileImage || null,
            documents: {
                experienceCertificate: uploadedUrls.experienceCertificate || null,
                twelfthMarksheet: uploadedUrls.twelfthMarksheet || null,
                tenthMarksheet: uploadedUrls.tenthMarksheet || null,
                graduationMarksheet: uploadedUrls.graduationMarksheet || null,
                postGraduationMarksheet: uploadedUrls.postGraduationMarksheet || null,
                aadhaarFile: uploadedUrls.aadhaarFile || null,
                panFile: uploadedUrls.panFile || null,
                passbookFile: uploadedUrls.passbookFile || null,
                medicalDocument: uploadedUrls.medicalDocument || null,
            }
        };

        // console.log('Final Entity Ready for DB persistence:', sanitizedData);

        // 4. Save to database
        const newEmployee = new this.employeeModel(sanitizedData);
        return await newEmployee.save();

        // return { success: true, data: sanitizedData };
    }
}