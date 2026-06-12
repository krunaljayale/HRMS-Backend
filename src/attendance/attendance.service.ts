import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendanceDocument } from './schemas/attendance.schema';
import { HolidayService } from '../holiday/holiday.service';
import { getDistanceInMeters } from './utils/geo.util';
import { CheckInDto, CheckOutDto } from './dto/punch.dto';
import { EmployeeService } from '../employee/employee.service';
import { createTodayISTThreshold, getIST } from '../utils/time.utils';
import { TrackLocationDto } from './dto/track-location.dto';
import { LeaveService } from '../leave/leave.service';
import { CorrectionRequestDto } from './dto/request-correction.dto';

@Injectable()
export class AttendanceService {
    // Office configurations (can be moved to @nestjs/config later)
    private readonly OFFICE_LAT = 18.5339582;
    private readonly OFFICE_LON = 73.839535;
    private readonly GEOFENCE_RADIUS_METERS = 50;

    constructor(
        @InjectModel('Attendance') private attendanceModel: Model<AttendanceDocument>,
        private holidayService: HolidayService,
        private employeeService: EmployeeService,
        private leaveService: LeaveService,
    ) { }

    private validateLocation(
        latitude: number | undefined,
        longitude: number | undefined,
        workMode: string,
    ) {
        // All Office punches are strictly validated.
        if (workMode === 'Office') {
            if (latitude == null || longitude == null) {
                throw new BadRequestException('Location coordinates are required for Office punch.');
            }

            const distance = getDistanceInMeters(this.OFFICE_LAT, this.OFFICE_LON, latitude, longitude);
            if (distance > this.GEOFENCE_RADIUS_METERS) {
                throw new BadRequestException(
                    `Outside office premises (${Math.round(distance)}m away). Must be within ${this.GEOFENCE_RADIUS_METERS}m.`,
                );
            }
        }
    }

    // ─── CORE API METHODS ───────────────────────────────────────────────
    /**
     * Fetches today's attendance record and office configurations.
     */
    async getTodayStatus(employeeId: string) {
        const now = getIST('date');

        // 1. Find the record, but EXCLUDE heavy arrays to save mobile bandwidth
        const record = await this.attendanceModel.findOne({
            employeeId: new Types.ObjectId(employeeId),
            date: now,
        })
            .select('-locationHistory -correctionHistory') // THE MODIFICATION
            .lean()
            .exec();

        // 2. Return the data (If no record is found, 'record' will cleanly be null)
        return {
            record: record,
            date: now,
        };
    }

    // ─── CHECK IN ──────────────────────────────────────────────────────────

    async checkIn(jwtPayload: any, dto: CheckInDto) {
        const session = await this.attendanceModel.db.startSession();
        session.startTransaction();

        try {
            //  1. GET BOTH TYPES OF TIME 
            const now = getIST();
            const dateString = getIST('date');

            const fullEmployee = await this.employeeService.getEmployeeById(jwtPayload.employeeId, 'employeeCode name _id');
            this.validateLocation(dto.latitude, dto.longitude, dto.workMode);

            // 2. Check for existing record
            const existing = await this.attendanceModel.findOne({
                employeeCode: fullEmployee.employeeCode,
                date: dateString,
            }).session(session);

            // 3. STRICT ENFORCEMENT: If it exists, block it. No updates allowed.
            if (existing) {
                throw new BadRequestException('Attendance record already exists for today.');
            }

            // 4. Logic for late calculation
            const shiftStart = createTodayISTThreshold('09:30:00');
            const bufferLimit = createTodayISTThreshold('10:00:00');

            //  Use the 'now' Date object for the math
            const isLate = now > bufferLimit;
            const lateMinutes = isLate ? Math.round((now.getTime() - shiftStart.getTime()) / 60000) : 0;

            // 5. Create new record
            const [attendance] = await this.attendanceModel.create([{
                employeeId: fullEmployee._id,
                employeeCode: fullEmployee.employeeCode,
                employeeName: fullEmployee.name,
                date: dateString, // String
                inTime: now,      // Date object
                status: 'P',
                isGeoAttendance: true,
                checkInLatitude: dto.latitude,
                checkInLongitude: dto.longitude,
                workMode: dto.workMode,
                locationHistory: [{
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    timestamp: now, // Date object
                }],
                isLate,
                lateMinutes,
                correctionStatus: 'None',
            }], { session });

            await session.commitTransaction();
            return { attendance, checkedInAt: now };

        } catch (error) {
            console.error('Error during check-in:', error);
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    // ─── CHECK OUT ─────────────────────────────────────────────────────────
    async checkOut(jwtPayload: any, dto: CheckOutDto) {
        // 1. Initialize Database Transaction
        const session = await this.attendanceModel.db.startSession();
        session.startTransaction();

        try {
            // 2. GET BOTH TYPES OF TIME USING NEW UTILS
            const now = getIST() as Date;
            const dateString = getIST('date') as string;

            // 3. Fetch exact employee (Fixes the bug where employeeId was passed to employeeCode)
            const fullEmployee = await this.employeeService.getEmployeeById(jwtPayload.employeeId, 'employeeCode');

            // 4. Find today's record explicitly using the transaction session
            const attendance = await this.attendanceModel.findOne({
                employeeCode: fullEmployee.employeeCode,
                date: dateString,
            }).session(session);

            // 5. Strict Validations
            if (!attendance) throw new BadRequestException('No attendance record found for today.');
            if (!attendance.inTime) throw new BadRequestException('No check-in found for today. Please check in first.');
            if (attendance.outTime) throw new BadRequestException('Already checked out today.');

            // 6. Geo Validation
            this.validateLocation(dto.latitude, dto.longitude, attendance.workMode);

            // 7. Calculate Worked Hours mathematically
            const workedMs = now.getTime() - attendance.inTime.getTime();
            const totalMinutes = Math.round(workedMs / 60000);
            const totalHours = Number((workedMs / 3600000).toFixed(2));

            // 8. Determine Shift Requirements using accurate IST day
            const istDateStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
            const dayOfWeek = new Date(istDateStr).getDay(); // 0 = Sunday, 6 = Saturday
            const shiftMinutes = 510; //dayOfWeek === 6 ? 420 : 510; // Sat = 7 hrs, Mon-Fri = 8.5 hrs

            // 9. Overtime & Shortfall
            let overtimeMinutes = 0;
            let shortfallMinutes = 0;
            if (totalMinutes >= shiftMinutes) {
                overtimeMinutes = totalMinutes - shiftMinutes;
            } else {
                shortfallMinutes = shiftMinutes - totalMinutes;
            }

            // 10. Finalize Status
            const isSunday = dayOfWeek === 0;
            const isHoliday = await this.holidayService.checkIsHoliday(dateString);

            // Calculate hurdles for both regular days and comp-offs
            const halfDayHurdle = shiftMinutes / 2;
            const tenMinuteGrace = 10;

            //  NEW: Track the value of the token we need to mint
            let earnedCompOffValue = 0;

            if (isSunday || isHoliday) {
                //  CompOff Evaluation (Full vs Half)
                if (totalMinutes >= shiftMinutes) {
                    attendance.status = 'CompOff';
                    earnedCompOffValue = 1;
                } else if ((totalMinutes + tenMinuteGrace) >= halfDayHurdle) {
                    attendance.status = 'HalfCompOff';
                    earnedCompOffValue = 0.5;
                } else {
                    // Worked less than 4.5 hours on a Sunday. No token earned.
                    attendance.status = 'P';
                }
            } else {
                // Normal Working Day Evaluation
                if (totalMinutes >= shiftMinutes) {
                    attendance.status = 'P'; // Full Day
                }
                else if ((totalMinutes + tenMinuteGrace) >= halfDayHurdle) {
                    attendance.status = 'Half'; // Half Day
                }
                else {
                    attendance.status = 'A'; // Absent / LOP
                }
            }

            // 11. Update Record Fields
            attendance.outTime = now;
            attendance.totalHours = totalHours;
            attendance.totalMinutes = totalMinutes;
            attendance.checkOutLatitude = dto.latitude;
            attendance.checkOutLongitude = dto.longitude;

            // 12. Save End of Day Report
            attendance.todayWork = dto.todayWork;
            attendance.pendingWork = dto.pendingWork;
            attendance.issuesFaced = dto.issuesFaced;
            attendance.reportParticipant = dto.reportParticipant

            // 13. Breadcrumb location
            if (dto.latitude != null && dto.longitude != null) {
                if (!attendance.locationHistory) {
                    attendance.locationHistory = [];
                }
                attendance.locationHistory.push({
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    timestamp: now,
                });
            }

            // 13.5 MINT COMP-OFF TOKEN IF EARNED 
            if (earnedCompOffValue > 0) {
                await this.leaveService.createCompOff(
                    jwtPayload.employeeId,
                    {
                        attendanceId: attendance._id.toString(),
                        value: earnedCompOffValue
                    },
                    session
                );
            }

            // 14. SAVE WITH SESSION AND COMMIT
            await attendance.save({ session });
            await session.commitTransaction();

            return {
                record: attendance,
                checkedOutAt: now,
                totalHours,
                totalMinutes,
                overtimeMinutes,
                shortfallMinutes,
            };

        } catch (error) {
            console.error('Error during check-out:', error);
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    async getReportingManager(employeeId: string) {
        const employee = await this.employeeService.getEmployeeById(employeeId, 'managerId');

        if (!employee) {
            throw new NotFoundException(`Employee with ID ${employeeId} not found`);
        }

        // 1. Check if managerId exists to satisfy the optional '?' type
        if (!employee.managerId) {
            return null;
        }

        // 2. Convert the ObjectId to a string using .toString()
        const managerIdString = employee.managerId.toString();

        // 3. Pass the string into the service
        return this.employeeService.getEmployeeById(managerIdString, '_id name position');
    }

    async trackLocation(employeeId: string, dto: TrackLocationDto): Promise<void> {
        const dateString = getIST('date');
        const now = getIST();

        // 1. Fetch employee code quickly
        const fullEmployee = await this.employeeService.getEmployeeById(employeeId, 'employeeCode');

        // 2. Perform the atomic update operation
        const result = await this.attendanceModel.updateOne(
            {
                employeeCode: fullEmployee.employeeCode,
                date: dateString,
                outTime: { $exists: false }
            },
            {
                $push: {
                    locationHistory: {
                        latitude: dto.latitude,
                        longitude: dto.longitude,
                        timestamp: now
                    }
                }
            }
        ).exec();

        if (result.matchedCount === 0) {
            console.log(`Tracking ignored: No active shift for employee ${fullEmployee.employeeCode} on ${dateString}`);
        }
    }

    async getMonthlyPerformanceInsights(employeeId: string) {
        // 1. Get the current date in 'YYYY-MM-DD' format
        const todayStr = getIST('date'); // e.g., "2026-06-09"

        // Extract year-month to create the prefix for the $regex
        // This removes the need for manual date object construction
        const currentMonthPrefix = todayStr.substring(0, 7); // "2026-06"

        // 2. Run the aggregation
        const insights = await this.attendanceModel.aggregate([
            {
                $match: {
                    employeeId: new Types.ObjectId(employeeId),
                    // Uses the exact same format as stored in your 'date' field
                    date: { $regex: `^${currentMonthPrefix}` }
                }
            },
            {
                $group: {
                    _id: null,
                    presentCount: {
                        $sum: { $cond: [{ $eq: ["$status", "P"] }, 1, 0] }
                    },
                    absentCount: {
                        $sum: { $cond: [{ $eq: ["$status", "A"] }, 1, 0] }
                    },
                    lateCount: {
                        $sum: { $cond: [{ $eq: ["$isLate", true] }, 1, 0] }
                    },
                    totalAccumulatedHours: {
                        $sum: "$totalHours"
                    }
                }
            }
        ]);

        // 3. Format the response exactly how your frontend InsightsData interface expects it
        if (insights.length === 0) {
            return { present: 0, absent: 0, late: 0, totalHours: 0 };
        }

        const data = insights[0];

        // Calculate the daily average hours (Total Hours / Days Present)
        const avgHours = data.presentCount > 0
            ? parseFloat((data.totalAccumulatedHours / data.presentCount).toFixed(1))
            : 0;

        return {
            present: data.presentCount,
            absent: data.absentCount,
            late: data.lateCount,
            totalHours: avgHours
        };
    }

    // ── ATTENDANCE CALENDAR / HISTORY ──
    async getMonthlyAttendanceList(employeeId: string, year: string, month: string) {
        const formattedMonth = month.padStart(2, '0');
        const monthPrefix = `${year}-${formattedMonth}`;
        const todayStr = getIST('date');
        const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

        // 1. Fetch Attendance Records
        const dbRecords = await this.attendanceModel.find({
            employeeId: new Types.ObjectId(employeeId),
            date: { $regex: `^${monthPrefix}` }
        }).lean();

        const recordMap = new Map();
        dbRecords.forEach(r => recordMap.set(r.date, r));

        //  2. Fetch Holidays via HolidayService
        const holidays = await this.holidayService.findHolidaysByMonth(Number(year), Number(month));

        const holidayMap = new Map();
        holidays.forEach(h => {
            // Convert native Date to "YYYY-MM-DD" string so it matches our loop
            const hDate = new Date(h.date);
            const dateStr = `${hDate.getUTCFullYear()}-${String(hDate.getUTCMonth() + 1).padStart(2, '0')}-${String(hDate.getUTCDate()).padStart(2, '0')}`;
            holidayMap.set(dateStr, h);
        });

        const summary = { present: 0, absent: 0, halfDay: 0, weekOffHoliday: 0 };
        const dailyList: any[] = [];

        // 3. The Gap-Filling Loop
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${year}-${formattedMonth}-${String(i).padStart(2, '0')}`;
            const jsDate = new Date(Number(year), Number(month) - 1, i);
            const isSunday = jsDate.getDay() === 0;

            const myRecord = recordMap.get(dateStr);
            const holidayRecord = holidayMap.get(dateStr);
            const isFutureDate = dateStr > todayStr;

            const dayData = {
                date: dateStr,
                myAttendance: myRecord || null,
                sharedReports: [],
                status: 'A',
                isWeekOff: isSunday,
                holiday: holidayRecord || null
            };

            // ── The Priority Logic ──
            if (myRecord && (myRecord.inTime || (myRecord.status && !['A', 'H'].includes(myRecord.status)))) {
                dayData.status = myRecord.status || 'P';

                if (dayData.status === 'P') summary.present++;
                if (dayData.status === 'Half') summary.halfDay++;
            }
            else if (holidayRecord) {
                dayData.status = 'H';
                summary.weekOffHoliday++;
            }
            else if (isSunday) {
                dayData.status = 'WO';
                summary.weekOffHoliday++;
            }
            else if (isFutureDate) {
                dayData.status = 'Pending';
            }
            else {
                dayData.status = 'A';
                summary.absent++;
            }

            dailyList.push(dayData);
        }

        return {
            summary,
            records: dailyList
        };
    }

    // ── ATTENDANCE CORRECTIONS ──
    async requestCorrection(attendanceId: string, employeeId: string, dto: CorrectionRequestDto) {
        // 1. Find the specific attendance record
        const attendance = await this.attendanceModel.findById(attendanceId);

        if (!attendance) {
            throw new NotFoundException('Attendance record not found');
        }

        // 2. Security Check: Ensure the user owns this record
        if (attendance.employeeId.toString() !== employeeId.toString()) {
            throw new UnauthorizedException('You can only request corrections for your own attendance.');
        }

        // 3. Prevent duplicate active requests
        //  UPDATED: Safely checks against the exact 'Pending' enum
        if (attendance.correctionRequested && attendance.correctionStatus === 'Pending') {
            throw new ConflictException('A correction request is already pending for this day.');
        }

        // 4. Save the PROPOSED state into the active request envelope
        attendance.activeCorrectionRequest = {
            requestedInTime: dto.requestedInTime ? new Date(dto.requestedInTime) : undefined,
            requestedOutTime: dto.requestedOutTime ? new Date(dto.requestedOutTime) : undefined,
            reason: dto.reason,
            proofUrl: dto.proofUrl || '',
            requestedOn: getIST() as Date,
        };

        // 5. Append to the AUDIT TRAIL
        attendance.correctionHistory.push({
            action: 'Requested',
            byRole: 'Employee', // The person making the request
            byEmployeeId: new Types.ObjectId(employeeId), // Maps to the Employee ref
            // NOTE: byAdminId is correctly omitted here since it's an employee action
            remark: 'Correction requested by employee',
            timestamp: getIST() as Date
        } as any); // Cast as any if TS complains about Mongoose subdocument arrays

        // 6. Update the main status flags
        attendance.correctionRequested = true;

        //  UPDATED: Matches the new cleaned enum ['None', 'Pending', 'Approved', 'Rejected']
        attendance.correctionStatus = 'Pending';

        await attendance.save();

        return {
            success: true,
            message: 'Correction request submitted successfully and is pending approval.'
        };
    }

    // ── PAYROLL ENGINE HELPER: FETCH RECORDS IN RANGE ──
    async findRecordsInRange(employeeId: string, fromDate: Date, toDate: Date): Promise<AttendanceDocument[]> {
        const startDateStr = getIST('date', fromDate);
        const endDateStr = getIST('date', toDate);

        return await this.attendanceModel
            .find({
                employeeId: new Types.ObjectId(employeeId),
                date: {
                    $gte: startDateStr,
                    $lte: endDateStr,
                },
            })
            .sort({ date: 1 }) // Keep days sequential for calculation iterations
            .lean() // Plain JS objects for high performance processing
            .exec() as unknown as AttendanceDocument[];
    }

}