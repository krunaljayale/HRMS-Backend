import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UpdateFcmTokenDto } from './dto/update-fcm.dto';
import { GetDirectoryDto } from './dto/get-directory.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { LeaveService } from '../leave/leave.service';

@Injectable()
export class EmployeeService {
  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(forwardRef(() => LeaveService))
    private readonly leaveService: LeaveService,
  ) { }

  async validatePassword(
    employeeCode: string,
    plainTextPass: string,
  ): Promise<any> {
    // Find the user and EXPLICITLY ask for the hidden password field
    const employee = await this.employeeModel
      .findOne({ employeeCode: employeeCode })
      .select('+password')
      .exec();

    if (!employee) {
      return null; // User not found
    }

    // Compare the typed password with the hashed password in the DB
    const isPasswordValid = await bcrypt.compare(
      plainTextPass,
      employee.password,
    );

    if (!isPasswordValid) {
      return null; // Wrong password
    }

    // Strip the password out safely using destructuring before returning
    const { password, ...safeEmployee } = employee.toObject();

    return safeEmployee;
  }

  async updatePassword(
    employeeID: string,
    changePasswordDto: ChangePasswordDto,
  ) {
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
    const isPasswordValid = await bcrypt.compare(
      oldPassword,
      employee.password,
    );

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
      message: 'Password updated successfully',
    };
  }

  // ── GET EMPLOYEE BY ID (Optimized with Select) ──
  async getEmployeeById(
    id: string,
    selectFields?: string | Record<string, number | boolean>,
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

  // ─── FETCH ONLY ACTIVE EMPLOYEES (Optional Helper) ───────────
  /**
   * A cleaner alternative if you prefer not to pass the filter object
   * directly from the payroll service.
   */
  async getActiveEmployees(): Promise<EmployeeDocument[]> {
    return await this.employeeModel.find({ status: 'Active' }).exec();
  }

  // ── UPDATE FCM TOKEN ──
  async updateFcmToken(
    employeeId: string,
    fcmData: UpdateFcmTokenDto,
  ): Promise<void> {
    const updatedEmployee = await this.employeeModel.findByIdAndUpdate(
      employeeId,
      {
        $set: {
          fcmToken: fcmData.fcmToken,
        },
      },
      { returnDocument: 'after' },
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
        .select(
          'name email mobileNumber role department position profileImageUrl employeeCode',
        )
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
      {
        label: 'tomorrow',
        month: tomorrow.getMonth() + 1,
        day: tomorrow.getDate(),
      },
      {
        label: 'dayAfter',
        month: dayAfterTomorrow.getMonth() + 1,
        day: dayAfterTomorrow.getDate(),
      },
    ];

    // 3. Build the MongoDB $or array dynamically
    const matchConditions = targetDates.map((d) => ({
      birthMonth: d.month,
      birthDay: d.day,
    }));

    // 4. Run the Aggregation Pipeline
    const employees = await this.employeeModel.aggregate([
      {
        $match: {
          status: 'Active',
          dateOfBirth: { $exists: true }, // Removed strict $type check
        },
      },
      {
        //  NEW STAGE: Safely parse Strings into Dates on the fly
        $addFields: {
          parsedDOB: { $toDate: '$dateOfBirth' },
        },
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
          birthDay: { $dayOfMonth: '$parsedDOB' },
        },
      },
      {
        $match: {
          $or: matchConditions,
        },
      },
    ]);

    // 5. Initialize the structured return object
    const result = {
      today: [] as any[],
      tomorrow: [] as any[],
      upcoming: [] as any[],
    };

    // 6. Group the results
    employees.forEach((emp) => {
      if (
        emp.birthMonth === targetDates[0].month &&
        emp.birthDay === targetDates[0].day
      ) {
        result.today.push(emp);
      } else if (
        emp.birthMonth === targetDates[1].month &&
        emp.birthDay === targetDates[1].day
      ) {
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

  async addFaceDescriptor(
    employeeId: string,
    faceDescriptors: number[][],
    imageBase64: string,
  ): Promise<void> {
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
      { new: true }, // Return the updated document
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
      throw new InternalServerErrorException(
        'Failed to calculate department statistics',
      );
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
            targetDate: { $ifNull: ['$joiningDate', '$createdAt'] },
          },
        },

        // Sort strictly by our newly computed targetDate, descending (newest first)
        { $sort: { targetDate: -1 } },

        // Grab only the top 5
        { $limit: 5 },
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

  async getAllEmployeesForHR(
    search?: string,
    department?: string,
    status?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const query: any = {};

    // 1. Apply exact match filters
    if (department) query.department = department;
    if (status) query.status = status;

    // 2. Apply search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ];
    }

    // 3. Calculate skip value
    const skip = (page - 1) * limit;

    // 4. Run Count and Find in parallel for better performance
    const [employees, totalRecords] = await Promise.all([
      this.employeeModel
        .find(query)
        .select(
          'employeeCode name email department position status profileImageUrl managerId',
        )
        .populate('managerId', 'name')
        .sort({ employeeCode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.employeeModel.countDocuments(query),
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
        limit,
      },
    };
  }

  async getLeadership(): Promise<
    { _id: string; name: string; employeeCode: string }[]
  > {
    const managers = await this.employeeModel
      .find({ isLeadershipRole: true, status: 'Active' })
      .select('name employeeCode')
      .sort({ employeeCode: 1 })
      .lean();

    return managers.map((manager) => ({
      _id: manager._id.toString(),
      name: manager.name,
      employeeCode: manager.employeeCode,
    }));
  }

  async generateNewEmployeeCode(): Promise<string> {
    // 1. Find the employee with the highest employeeCode, excluding the Play Store account
    const lastEmployee = await this.employeeModel
      .findOne({
        employeeCode: {
          $regex: /^IA\d{5}$/,
          $ne: 'IA11111', // Exclude the Play Store account from the sequence calculation
        },
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

  async createEmployeeProfile(
    rawData: any,
    files: Record<string, Express.Multer.File[]>,
  ) {
    const uploadedUrls: Record<string, string> = {};

    // 1. Process files sequentially to prevent Cloudinary payload bottlenecks
    if (files && Object.keys(files).length > 0) {
      const fileKeys = Object.keys(files);
      const chunkSize = 3; // Upload 3 files at exactly the same time

      for (let i = 0; i < fileKeys.length; i += chunkSize) {
        const chunk = fileKeys.slice(i, i + chunkSize);

        // Process chunk in parallel
        await Promise.all(
          chunk.map(async (fieldKey) => {
            const fileArray = files[fieldKey];
            if (fileArray && fileArray[0]) {
              try {
                const uploadResult = await this.cloudinaryService.uploadFile(
                  fileArray[0],
                  `new_hrms_employees_data/${rawData.employeeCode || 'unassigned'}`,
                );
                uploadedUrls[fieldKey] = uploadResult.secure_url;
              } catch (error) {
                console.error(`Failed to upload ${fieldKey}:`, error);
                throw new BadRequestException(
                  `File upload failed for ${fieldKey}`,
                );
              }
            }
          }),
        );
      }
    }

    // 2. Safe parsing of the address structure object
    let parsedAddress = rawData.address;
    if (typeof rawData.address === 'string') {
      try {
        parsedAddress = JSON.parse(rawData.address);
      } catch (e) {
        throw new BadRequestException(
          'The address field must be a valid stringified JSON object matching MultiResidencyAddress',
        );
      }
    }

    // 3. Safe ObjectId Conversion for managerId
    let castedManagerId: Types.ObjectId | undefined = undefined;
    if (rawData.managerId && Types.ObjectId.isValid(rawData.managerId)) {
      castedManagerId = new Types.ObjectId(rawData.managerId);
    } else if (rawData.managerId) {
      throw new BadRequestException(
        `Provided managerId "${rawData.managerId}" is not a valid MongoDB ObjectId`,
      );
    }

    // 4. Flatten structure out and apply defensive data-type casting
    const sanitizedData = {
      ...rawData,
      address: parsedAddress,
      managerId: castedManagerId,
      isAppAdmin: rawData.isAppAdmin === 'true' || rawData.isAppAdmin === true,
      isLeadershipRole:
        rawData.isLeadershipRole === 'true' ||
        rawData.isLeadershipRole === true,

      // Strictly parse as numbers and fallback to 0
      salary: rawData.salary && !isNaN(Number(rawData.salary))
        ? Number(rawData.salary)
        : 0,
      fixedAllowance: rawData.fixedAllowance && !isNaN(Number(rawData.fixedAllowance))
        ? Number(rawData.fixedAllowance)
        : 0,

      // Explicitly remove legacy salaryStructure if the frontend still sends it
      salaryStructure: undefined,

      totalExperienceYears:
        rawData.totalExperienceYears &&
          !isNaN(Number(rawData.totalExperienceYears))
          ? Number(rawData.totalExperienceYears)
          : undefined,
      hscPercent:
        rawData.hscPercent && !isNaN(Number(rawData.hscPercent))
          ? Number(rawData.hscPercent)
          : undefined,
      graduationPercent:
        rawData.graduationPercent && !isNaN(Number(rawData.graduationPercent))
          ? Number(rawData.graduationPercent)
          : undefined,
      postGraduationPercent:
        rawData.postGraduationPercent &&
          !isNaN(Number(rawData.postGraduationPercent))
          ? Number(rawData.postGraduationPercent)
          : undefined,

      // Strings mapping cleanly to your root-level schema definitions
      diseaseSince: rawData.diseaseSince
        ? String(rawData.diseaseSince)
        : undefined,

      // Flat top-level schema document properties mapping
      profileImageUrl: uploadedUrls.profileImage || undefined,
      experienceCertificateUrl: uploadedUrls.experienceCertificate || undefined,
      twelfthMarksheetUrl: uploadedUrls.twelfthMarksheet || undefined,
      tenthMarksheetUrl: uploadedUrls.tenthMarksheet || undefined,
      graduationMarksheetUrl: uploadedUrls.graduationMarksheet || undefined,
      postGraduationMarksheetUrl:
        uploadedUrls.postGraduationMarksheet || undefined,
      aadhaarFileUrl: uploadedUrls.aadhaarFile || undefined,
      panFileUrl: uploadedUrls.panFile || undefined,
      passbookFileUrl: uploadedUrls.passbookFile || undefined,
      medicalDocumentUrl: uploadedUrls.medicalDocument || undefined,
    };

    // Clean out all explicit undefined properties to avoid pipeline conflicts
    Object.keys(sanitizedData).forEach(
      (key) => sanitizedData[key] === undefined && delete sanitizedData[key],
    );

    // console.log('Pushing to Mongoose Engine Context Layer:', sanitizedData);

    // 5. Instantiation and database execution save block
    try {
      const newEmployee = new this.employeeModel(sanitizedData);
      return await newEmployee.save();
    } catch (dbError: any) {
      console.error('Mongoose collection pipeline error details:', dbError);
      throw new BadRequestException(
        `Database persistence failed: ${dbError.message}`,
      );
    }
  }

  async updateEmployeeProfile(
    id: string,
    rawData: any,
    files: Record<string, Express.Multer.File[]>,
  ) {
    const uploadedUrls: Record<string, string> = {};

    // 1. Process NEW files if any were uploaded
    if (files && Object.keys(files).length > 0) {
      const fileKeys = Object.keys(files);
      const chunkSize = 3;

      for (let i = 0; i < fileKeys.length; i += chunkSize) {
        const chunk = fileKeys.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (fieldKey) => {
            const fileArray = files[fieldKey];
            if (fileArray && fileArray[0]) {
              try {
                const uploadResult = await this.cloudinaryService.uploadFile(
                  fileArray[0],
                  `new_hrms_employees_data/${rawData.employeeCode || 'unassigned'}`,
                );
                uploadedUrls[fieldKey] = uploadResult.secure_url;
              } catch (error) {
                console.error(`Failed to upload ${fieldKey}:`, error);
                throw new BadRequestException(`File upload failed for ${fieldKey}`);
              }
            }
          }),
        );
      }
    }

    // 2. Safe parsing of the address structure object
    let parsedAddress = rawData.address;
    if (typeof rawData.address === 'string') {
      try {
        parsedAddress = JSON.parse(rawData.address);
      } catch (e) {
        throw new BadRequestException('The address field must be valid JSON');
      }
    }

    // 3. Safe ObjectId Conversion for managerId
    let castedManagerId: Types.ObjectId | undefined = undefined;
    if (rawData.managerId && Types.ObjectId.isValid(rawData.managerId)) {
      castedManagerId = new Types.ObjectId(rawData.managerId);
    }

    // 4. Flatten structure out and apply defensive data-type casting
    const sanitizedData = {
      ...rawData,
      address: parsedAddress,
      ...(castedManagerId && { managerId: castedManagerId }),
      isAppAdmin: rawData.isAppAdmin === 'true' || rawData.isAppAdmin === true,
      isLeadershipRole: rawData.isLeadershipRole === 'true' || rawData.isLeadershipRole === true,

      salary: rawData.salary && !isNaN(Number(rawData.salary)) ? Number(rawData.salary) : undefined,
      fixedAllowance: rawData.fixedAllowance && !isNaN(Number(rawData.fixedAllowance)) ? Number(rawData.fixedAllowance) : undefined,
      totalExperienceYears: rawData.totalExperienceYears && !isNaN(Number(rawData.totalExperienceYears)) ? Number(rawData.totalExperienceYears) : undefined,
      hscPercent: rawData.hscPercent && !isNaN(Number(rawData.hscPercent)) ? Number(rawData.hscPercent) : undefined,
      graduationPercent: rawData.graduationPercent && !isNaN(Number(rawData.graduationPercent)) ? Number(rawData.graduationPercent) : undefined,
      postGraduationPercent: rawData.postGraduationPercent && !isNaN(Number(rawData.postGraduationPercent)) ? Number(rawData.postGraduationPercent) : undefined,

      // Apply new URLs only if they were newly uploaded
      ...(uploadedUrls.profileImage && { profileImageUrl: uploadedUrls.profileImage }),
      ...(uploadedUrls.experienceCertificate && { experienceCertificateUrl: uploadedUrls.experienceCertificate }),
      ...(uploadedUrls.twelfthMarksheet && { twelfthMarksheetUrl: uploadedUrls.twelfthMarksheet }),
      ...(uploadedUrls.tenthMarksheet && { tenthMarksheetUrl: uploadedUrls.tenthMarksheet }),
      ...(uploadedUrls.graduationMarksheet && { graduationMarksheetUrl: uploadedUrls.graduationMarksheet }),
      ...(uploadedUrls.postGraduationMarksheet && { postGraduationMarksheetUrl: uploadedUrls.postGraduationMarksheet }),
      ...(uploadedUrls.aadhaarFile && { aadhaarFileUrl: uploadedUrls.aadhaarFile }),
      ...(uploadedUrls.panFile && { panFileUrl: uploadedUrls.panFile }),
      ...(uploadedUrls.passbookFile && { passbookFileUrl: uploadedUrls.passbookFile }),
      ...(uploadedUrls.medicalDocument && { medicalDocumentUrl: uploadedUrls.medicalDocument }),
    };

    // Remove empty/undefined properties to prevent overwriting existing DB data with nulls
    Object.keys(sanitizedData).forEach((key) => {
      if (sanitizedData[key] === undefined || sanitizedData[key] === '') {
        delete sanitizedData[key];
      }
    });

    // 5. Update DB
    try {
      const updatedEmployee = await this.employeeModel.findByIdAndUpdate(
        id,
        { $set: sanitizedData },
        { new: true, runValidators: true }
      );
      if (!updatedEmployee) throw new NotFoundException('Employee not found');
      return updatedEmployee;
    } catch (dbError: any) {
      console.error('Update failed:', dbError);
      throw new BadRequestException(`Database update failed: ${dbError.message}`);
    }
  }

  async getManagerApprovalMetrics(managerId: string) {
    if (!Types.ObjectId.isValid(managerId)) {
      throw new BadRequestException('Invalid manager ID format.');
    }

    const targetId = new Types.ObjectId(managerId);

    // 1. Fetch manager metadata profile
    const manager = await this.employeeModel.findById(targetId).select('isLeadershipRole').lean();
    if (!manager) {
      throw new NotFoundException('Employee profile not found.');
    }

    if (!manager.isLeadershipRole) {
      return { isLeadership: false, pendingApprovalsCount: 0 };
    }

    // 2. Fetch reporting employee document reference records
    const directReportEmployees = await this.employeeModel
      .find({ managerId: targetId })
      .select('_id')
      .lean();

    const reportIds = directReportEmployees.map((emp) => emp._id);

    if (reportIds.length === 0) {
      return { isLeadership: true, pendingApprovalsCount: 0 };
    }

    // 3. Delegate cross-module query context to the correct service safely
    const pendingCount = await this.leaveService.countPendingApprovalsForManager(targetId, reportIds);

    return {
      isLeadership: true,
      pendingApprovalsCount: pendingCount,
    };
  }

  /**
 * Orchestrates fetching full detailed pending leave requests for a specific manager
 * @param managerId string representing the employee ObjectId
 */
  async getManagerDetailedRequests(managerId: string) {
    if (!Types.ObjectId.isValid(managerId)) {
      throw new BadRequestException('Invalid manager ID format.');
    }

    const targetId = new Types.ObjectId(managerId);

    // 1. Fetch manager metadata profile to confirm leadership status
    const manager = await this.employeeModel.findById(targetId).select('isLeadershipRole').lean();
    if (!manager) {
      throw new NotFoundException('Employee profile not found.');
    }

    if (!manager.isLeadershipRole) {
      return []; // Return empty array immediately if not a leadership account
    }

    // 2. Compile reporting employee document IDs
    const directReportEmployees = await this.employeeModel
      .find({ managerId: targetId })
      .select('_id')
      .lean();

    const reportIds = directReportEmployees.map((emp) => emp._id);

    if (reportIds.length === 0) {
      return []; // No subordinates means zero pending items
    }

    // 3. Request data payload from the Leave module layer safely
    return await this.leaveService.getPendingApprovalsForManager(targetId, reportIds);
  }

  /**
 * Orchestrates fetching historically processed leave actions for a manager
 */
  async getManagerActionHistory(managerId: string, page: number, limit: number, status?: string) {
    if (!Types.ObjectId.isValid(managerId)) {
      throw new BadRequestException('Invalid manager ID format.');
    }

    const targetId = new Types.ObjectId(managerId);

    const manager = await this.employeeModel.findById(targetId).select('isLeadershipRole').lean();
    if (!manager || !manager.isLeadershipRole) {
      return [];
    }

    const directReportEmployees = await this.employeeModel
      .find({ managerId: targetId })
      .select('_id')
      .lean();

    const reportIds = directReportEmployees.map((emp) => emp._id);
    if (reportIds.length === 0) return [];

    return await this.leaveService.getResolvedHistoryForManager(targetId, reportIds, page, limit, status);
  }

}
