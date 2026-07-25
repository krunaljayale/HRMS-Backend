import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { HolidayService } from '../holiday/holiday.service';
import { getDistanceInMeters } from './utils/geo.util';
import { CheckInDto, CheckOutDto } from './dto/punch.dto';
import { EmployeeService } from '../employee/employee.service';
import { createTodayISTThreshold, getIST } from '../utils/time.utils';
import { TrackLocationDto } from './dto/track-location.dto';
import { LeaveService } from '../leave/leave.service';
import { CorrectionRequestDto } from './dto/request-correction.dto';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AttendanceService {
    constructor(
        @InjectModel('Attendance') private attendanceModel: Model<AttendanceDocument>,
        private holidayService: HolidayService,
        private employeeService: EmployeeService,
        private leaveService: LeaveService,
        private readonly notificationService: NotificationService,
        private readonly systemConfigService: SystemConfigService,

    ) { }

    private async validateLocation(
        latitude: number | undefined,
        longitude: number | undefined,
        workMode: string,
    ) {
        // All Office punches are strictly validated.
        if (workMode === 'Office') {
            if (latitude == null || longitude == null) {
                throw new BadRequestException('Location coordinates are required for Office punch.');
            }

            // Fetch dynamic coordinates and radius from MongoDB
            const config = await this.systemConfigService.getActiveConfig();

            const distance = getDistanceInMeters(
                config.office_lat,
                config.office_lon,
                latitude,
                longitude
            );

            if (distance > config.radius_meters) {
                throw new BadRequestException(
                    `Outside office premises (${Math.round(distance)}m away). Must be within ${config.radius_meters}m.`,
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
            await this.validateLocation(dto.latitude, dto.longitude, dto.workMode);

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
            const bufferLimit = createTodayISTThreshold('10:00:00');

            //  Use the 'now' Date object for the math
            const isLate = now > bufferLimit;
            const lateMinutes = isLate ? Math.round((now.getTime() - bufferLimit.getTime()) / 60000) : 0;

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
            const now = getIST() as Date;

            // 2. Fetch exact employee
            const fullEmployee = await this.employeeService.getEmployeeById(jwtPayload.employeeId, 'employeeCode');

            // 3. Find the active open check-in record (handles midnight/overnight checkout)
            // By looking for missing outTime, we don't accidentally query tomorrow's date if they check out after 12:00 AM
            const attendance = await this.attendanceModel.findOne({
                employeeCode: fullEmployee.employeeCode,
                outTime: { $exists: false },
            }).sort({ createdAt: -1 }).session(session);

            // 4. Strict Validations
            if (!attendance) throw new BadRequestException('No active check-in found for checkout.');
            if (!attendance.inTime) throw new BadRequestException('Invalid check-in record.');

            // 5. Geo Validation
            await this.validateLocation(dto.latitude, dto.longitude, attendance.workMode);

            // 6. Calculate Worked Time safely (prevents 'getTime is not a function' errors)
            const inTimeMs = new Date(attendance.inTime).getTime();
            const workedMs = now.getTime() - inTimeMs;
            const totalMinutes = Math.max(0, Math.round(workedMs / 60000));
            const totalHours = Number((workedMs / 3600000).toFixed(2));

            // 7. Determine Day of Week & Holiday safely for AWS Lightsail (UTC fallback proof)
            const checkInDateStr = attendance.date; // Uses the string saved during check-in (e.g., "YYYY-MM-DD")
            const [year, month, day] = checkInDateStr.split('-').map(Number);

            // Date.UTC mathematically locks the date, bypassing the server's local timezone entirely
            const shiftDate = new Date(Date.UTC(year, month - 1, day));
            const dayOfWeek = shiftDate.getUTCDay(); // 0 = Sunday, 6 = Saturday

            const isSunday = dayOfWeek === 0;
            const isHoliday = await this.holidayService.checkIsHoliday(checkInDateStr);

            // 8. Shift & Grace Thresholds
            const shiftMinutes = 510; // 8.5 hours
            const tenMinuteGrace = 10;

            // Apply grace period fairly to both full and half days
            const fullDayThreshold = shiftMinutes - tenMinuteGrace; // 500 mins
            const halfDayThreshold = (shiftMinutes / 2) - tenMinuteGrace; // 245 mins

            let overtimeMinutes = 0;
            let shortfallMinutes = 0;
            let earnedCompOffValue = 0;

            // 9. Overtime & Shortfall Logic
            if (isSunday || isHoliday) {
                // On non-working days, all time worked is technically "overtime" and there is no shortfall
                overtimeMinutes = totalMinutes;
                shortfallMinutes = 0;
            } else {
                if (totalMinutes >= shiftMinutes) {
                    overtimeMinutes = totalMinutes - shiftMinutes;
                } else {
                    shortfallMinutes = shiftMinutes - totalMinutes;
                }
            }

            // 10. Status & Comp-Off Evaluation
            if (isSunday || isHoliday) {
                // CompOff Evaluation (Full vs Half)
                if (totalMinutes >= fullDayThreshold) {
                    attendance.status = 'CompOff';
                    earnedCompOffValue = 1;
                } else if (totalMinutes >= halfDayThreshold) {
                    attendance.status = 'HalfCompOff';
                    earnedCompOffValue = 0.5;
                } else {
                    // Worked less than the minimum hurdle on a weekend/holiday. No token earned.
                    attendance.status = 'A'; // Or whatever your policy dictates for an invalid weekend punch
                }
            } else {
                // Normal Working Day Evaluation
                if (totalMinutes >= fullDayThreshold) {
                    attendance.status = 'P'; // Full Day
                } else if (totalMinutes >= halfDayThreshold) {
                    attendance.status = 'Half'; // Half Day
                } else {
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
            attendance.reportParticipant = dto.reportParticipant;

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

            // 14. Mint Comp-Off Token if earned
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

            // 15. Save with session and commit
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
        const currentMonthPrefix = todayStr.substring(0, 7); // "2026-06"

        // Extract the day of the month (how many days have passed so far)
        const currentDay = parseInt(todayStr.substring(8, 10), 10);

        // 2. Run the aggregation
        const insights = await this.attendanceModel.aggregate([
            {
                $match: {
                    employeeId: new Types.ObjectId(employeeId),
                    date: { $regex: `^${currentMonthPrefix}` }
                }
            },
            {
                $group: {
                    _id: null,

                    // ── FIX 1: HALF DAY CALCULATION ──
                    presentCount: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $in: ["$status", ["P", "AUTO"]] }, then: 1 },
                                    { case: { $in: ["$status", ["Half", "HalfCompOff"]] }, then: 0.5 }
                                ],
                                default: 0
                            }
                        }
                    },

                    // Track 0.5 absents from half days, or any manual 'A' docs that sneak in
                    explicitAbsentCount: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$status", "A"] }, then: 1 },
                                    { case: { $in: ["$status", ["Half", "HalfCompOff"]] }, then: 0.5 }
                                ],
                                default: 0
                            }
                        }
                    },

                    // How many calendar days actually have a document? (P, Half, Leave, Holiday)
                    // We use this to find out how many days are completely missing from the DB
                    accountedCalendarDays: {
                        $sum: {
                            $cond: [
                                { $in: ["$status", ["P", "AUTO", "Half", "HalfCompOff", "L", "CompOff", "H"]] },
                                1, // Even a half-day counts as 1 known calendar day
                                0
                            ]
                        }
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

        // 3. Fallback values if no documents exist for the month yet
        let present = 0;
        let late = 0;
        let avgHours = 0;
        let explicitAbsent = 0;
        let accountedDays = 0;

        if (insights.length > 0) {
            const data = insights[0];
            present = data.presentCount;
            late = data.lateCount;
            explicitAbsent = data.explicitAbsentCount;
            accountedDays = data.accountedCalendarDays;

            avgHours = present > 0
                ? parseFloat((data.totalAccumulatedHours / present).toFixed(1))
                : 0;
        }

        // ── FIX 2: ABSENT CALCULATION (NON-EXISTENT DOCS) ──
        // Missing Days = (Days passed so far this month) - (Days we have records for)
        const missingDays = currentDay - accountedDays;

        // Out of these missing days, we need to NOT count Week Offs (Sundays) as Absents
        const [year, month] = currentMonthPrefix.split('-').map(Number);
        let weekOffsPassed = 0;

        for (let i = 1; i <= currentDay; i++) {
            const date = new Date(year, month - 1, i);
            if (date.getDay() === 0) { // 0 = Sunday. Change to 6 if Saturdays are week-offs, etc.
                weekOffsPassed++;
            }
        }

        // Unaccounted Absents = Missing DB records MINUS the expected Week Offs
        // Math.max(0, ...) prevents negative numbers if someone works on a Sunday
        const unaccountedAbsents = Math.max(0, missingDays - weekOffsPassed);

        // Total Absents = (Calculated missing days) + (Explicit 0.5 absents from half days)
        const absent = unaccountedAbsents + explicitAbsent;

        return {
            present,
            absent,
            late,
            totalHours: avgHours
        };
    }

    // ── ATTENDANCE CALENDAR / HISTORY ──
    // async getMonthlyAttendanceList(employeeId: string, year: string, month: string) {
    //     const formattedMonth = month.padStart(2, '0');
    //     const monthPrefix = `${year}-${formattedMonth}`;
    //     const todayStr = getIST('date');
    //     const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

    //     // 1. Fetch Attendance Records
    //     const dbRecords = await this.attendanceModel.find({
    //         employeeId: new Types.ObjectId(employeeId),
    //         date: { $regex: `^${monthPrefix}` }
    //     }).lean();

    //     const recordMap = new Map();
    //     dbRecords.forEach(r => recordMap.set(r.date, r));

    //     //  2. Fetch Holidays via HolidayService
    //     const holidays = await this.holidayService.findHolidaysByMonth(Number(year), Number(month));

    //     const holidayMap = new Map();
    //     holidays.forEach(h => {
    //         // Convert native Date to "YYYY-MM-DD" string so it matches our loop
    //         const hDate = new Date(h.date);
    //         const dateStr = `${hDate.getUTCFullYear()}-${String(hDate.getUTCMonth() + 1).padStart(2, '0')}-${String(hDate.getUTCDate()).padStart(2, '0')}`;
    //         holidayMap.set(dateStr, h);
    //     });

    //     const summary = { present: 0, absent: 0, halfDay: 0, weekOffHoliday: 0 };
    //     const dailyList: any[] = [];

    //     // 3. The Gap-Filling Loop
    //     for (let i = 1; i <= daysInMonth; i++) {
    //         const dateStr = `${year}-${formattedMonth}-${String(i).padStart(2, '0')}`;
    //         const jsDate = new Date(Number(year), Number(month) - 1, i);
    //         const isSunday = jsDate.getDay() === 0;

    //         const myRecord = recordMap.get(dateStr);
    //         const holidayRecord = holidayMap.get(dateStr);
    //         const isFutureDate = dateStr > todayStr;

    //         const dayData = {
    //             date: dateStr,
    //             myAttendance: myRecord || null,
    //             sharedReports: [],
    //             status: 'A',
    //             isWeekOff: isSunday,
    //             holiday: holidayRecord || null
    //         };

    //         // ── The Priority Logic ──
    //         if (myRecord && (myRecord.inTime || (myRecord.status && !['A', 'H'].includes(myRecord.status)))) {
    //             dayData.status = myRecord.status || 'P';

    //             if (dayData.status === 'P') summary.present++;
    //             if (dayData.status === 'Half') summary.halfDay++;
    //         }
    //         else if (holidayRecord) {
    //             dayData.status = 'H';
    //             summary.weekOffHoliday++;
    //         }
    //         else if (isSunday) {
    //             dayData.status = 'WO';
    //             summary.weekOffHoliday++;
    //         }
    //         else if (isFutureDate) {
    //             dayData.status = 'Pending';
    //         }
    //         else {
    //             dayData.status = 'A';
    //             summary.absent++;
    //         }

    //         dailyList.push(dayData);
    //     }

    //     return {
    //         summary,
    //         records: dailyList
    //     };
    // }

    async getMonthlyAttendanceList(employeeId: string, year: string, month: string) {
        const formattedMonth = month.padStart(2, '0');
        const monthPrefix = `${year}-${formattedMonth}`;
        const todayStr = getIST('date'); // Assuming this returns 'YYYY-MM-DD'
        const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

        // 1. Fetch Attendance Records
        const dbRecords = await this.attendanceModel.find({
            employeeId: new Types.ObjectId(employeeId),
            date: { $regex: `^${monthPrefix}` }
        }).lean();

        const recordMap = new Map();
        dbRecords.forEach(r => recordMap.set(r.date, r));

        // 2. Fetch Holidays via HolidayService
        const holidays = await this.holidayService.findHolidaysByMonth(Number(year), Number(month));

        const holidayMap = new Map();
        holidays.forEach(h => {
            const hDate = new Date(h.date);
            const dateStr = `${hDate.getUTCFullYear()}-${String(hDate.getUTCMonth() + 1).padStart(2, '0')}-${String(hDate.getUTCDate()).padStart(2, '0')}`;
            holidayMap.set(dateStr, h);
        });

        // 3. Fetch Leaves via LeaveService (Passing a high limit to ensure we capture relevant data)
        const leaveData = await this.leaveService.getEmployeeLeaveHistory(employeeId, 1000);
        const leaveMap = new Map();

        // Map out every individual day an employee is on an approved leave
        leaveData.leaves.forEach((leave: any) => {
            if (leave.overallStatus === 'Approved') {
                // Note: Change 'startDate' and 'endDate' to match your actual schema fields (e.g. fromDate/toDate)
                const start = new Date(leave.startDate);
                const end = new Date(leave.endDate);

                let current = new Date(start);
                while (current <= end) {
                    const lDateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;
                    leaveMap.set(lDateStr, leave);
                    current.setDate(current.getDate() + 1);
                }
            }
        });

        // Added 'leave: 0' to the summary object
        const summary = { present: 0, absent: 0, halfDay: 0, weekOffHoliday: 0, leave: 0 };
        const dailyList: any[] = [];

        // 4. The Gap-Filling Loop
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${year}-${formattedMonth}-${String(i).padStart(2, '0')}`;
            const jsDate = new Date(Number(year), Number(month) - 1, i);
            const isSunday = jsDate.getDay() === 0;

            const myRecord = recordMap.get(dateStr);
            const holidayRecord = holidayMap.get(dateStr);
            const leaveRecord = leaveMap.get(dateStr);
            const isFutureDate = dateStr > todayStr;

            const dayData = {
                date: dateStr,
                myAttendance: myRecord || null,
                sharedReports: [],
                status: 'A',
                isWeekOff: isSunday,
                holiday: holidayRecord || null,
                leave: leaveRecord || null
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
                // Future dates default to Pending. This prevents upcoming leaves from showing as "L" yet.
                dayData.status = 'Pending';
            }
            else if (leaveRecord) {
                // If it's a past date and a leave document exists
                dayData.status = 'L';
                summary.leave++;
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
    async findRecordsInRange(employeeId: string, fromDate: Date, toDate: Date, session?: ClientSession): Promise<AttendanceDocument[]> {
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
            .session(session || null) // Safely inject the session into the chain
            .sort({ date: 1 }) // Keep days sequential for calculation iterations
            .lean() // Plain JS objects for high performance processing
            .exec() as unknown as AttendanceDocument[];
    }

    async getTeamReportsForManager(managerId: string, dateStr: string): Promise<any[]> {
        const records = await this.attendanceModel
            .find({
                date: dateStr, // Direct string match against '2026-07-10'

                $expr: {
                    $eq: [{ $toString: '$reportParticipant' }, managerId]
                }
            })
            .populate({
                path: 'employeeId', // Populates the actual employee profile
                select: 'name position profileImageUrl',
            })
            .sort({ inTime: -1 })
            .lean();

        // Map the populated employeeId back to reportParticipant to keep the mobile UI happy
        return records.map((record: any) => ({
            ...record,
            reportParticipant: record.employeeId,
        }));
    }

    /**
    * Updates the read status tracker flag for a specific daily work report document.
    */
    async updateWorkReportReadStatus(reportId: string, isReportRead: boolean): Promise<Attendance> {
        const updatedReport = await this.attendanceModel.findByIdAndUpdate(
            new Types.ObjectId(reportId),
            { $set: { isReportRead } },

            // Swap { new: true } with this to eliminate the deprecation warning completely
            { returnDocument: 'after' }
        )
            .populate({
                path: 'employeeId',
                select: 'name position profileImageUrl',
            })
            .lean();

        if (!updatedReport) {
            throw new NotFoundException(`No attendance or work report record found with ID: ${reportId}`);
        }

        return updatedReport;
    }

    // ─────────────────────────────────────── HR SEVICES START ──────────────────────────────────────────

    async getTodayPresentCount(): Promise<number> {
        try {
            const todayStr = getIST('date'); // "YYYY-MM-DD"

            // Simply count how many records exist for today with a 'P' status
            return await this.attendanceModel.countDocuments({
                date: todayStr,
                status: 'P',
            });
        } catch (error) {
            console.error('Database getTodayPresentCount failure:', error);
            throw new InternalServerErrorException("Failed to calculate today's present count");
        }
    }

    /**
   * Calculates the average attendance rates grouped by Month or Year
   * @param viewMode - 'monthly' or 'yearly'
   */
    async getAggregateAttendanceStats(viewMode: 'monthly' | 'yearly') {
        try {
            const currentFullIST = getIST('full');
            const currentYear = currentFullIST.split('-')[0];

            let matchQuery: any = {};
            let groupFormat: any = '';

            if (viewMode === 'monthly') {
                matchQuery = { date: new RegExp(`^${currentYear}-`) };
                groupFormat = { $substr: ['$date', 5, 2] };
            } else {
                groupFormat = { $substr: ['$date', 0, 4] };
            }

            const rawAggregatedData = await this.attendanceModel.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: groupFormat,
                        presentDays: {
                            $sum: {
                                $switch: {
                                    branches: [
                                        { case: { $in: ['$status', ['P', 'CompOff']] }, then: 1 },
                                        { case: { $in: ['$status', ['Half', 'HalfCompOff']] }, then: 0.5 }
                                    ],
                                    default: 0
                                }
                            }
                        },
                        absentDays: {
                            $sum: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$status', 'A'] }, then: 1 },
                                        { case: { $in: ['$status', ['Half', 'HalfCompOff']] }, then: 0.5 }
                                    ],
                                    default: 0
                                }
                            }
                        },
                    },
                },
                { $sort: { _id: 1 } },
            ]);

            const monthsArray = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            // 1. UPDATED: Explicitly allow the value to be null in the type definition
            let processedStats: { label: string; value: number | null }[] = [];

            if (viewMode === 'monthly') {
                processedStats = monthsArray.map((monthName, index) => {
                    const monthKey = String(index + 1).padStart(2, '0');
                    const bucket = rawAggregatedData.find(d => d._id === monthKey);

                    // 2. UPDATED: Default to null (No Data) instead of 0%
                    let attendanceRate: number | null = null;

                    if (bucket) {
                        const present = bucket.presentDays || 0;
                        const absent = bucket.absentDays || 0;
                        const totalExpectedDays = present + absent;

                        if (totalExpectedDays > 0) {
                            attendanceRate = Math.round((present / totalExpectedDays) * 100);
                        } else {
                            attendanceRate = 0; // Only 0 if they genuinely had records but 0 attendance
                        }
                    }

                    return {
                        label: monthName,
                        value: attendanceRate,
                    };
                });
            } else {
                processedStats = rawAggregatedData.map((bucket) => {
                    const present = bucket.presentDays || 0;
                    const absent = bucket.absentDays || 0;
                    const totalExpectedDays = present + absent;
                    const attendanceRate = totalExpectedDays > 0
                        ? Math.round((present / totalExpectedDays) * 100)
                        : 0;

                    return {
                        label: bucket._id,
                        value: attendanceRate,
                    };
                });
            }

            return processedStats;
        } catch (error) {
            console.error(`Database getAggregateAttendanceStats error [${viewMode}]:`, error);
            throw new InternalServerErrorException('Failed to calculate attendance analytics metrics');
        }
    }

    async getLiveRoster(filters: { department?: string; workMode?: string; search?: string }) {
        try {
            const todayStr = getIST('date'); // Returns "YYYY-MM-DD"

            // 1. Build the Initial Match (Pre-Lookup optimization)
            const initialMatch: any = { date: todayStr };

            // Apply Work Mode filter if provided
            if (filters.workMode) {
                initialMatch.workMode = filters.workMode;
            }

            // Apply Search filter (Regex on Name or Code) if provided
            if (filters.search) {
                const searchRegex = new RegExp(filters.search, 'i');
                initialMatch.$or = [
                    { employeeName: searchRegex },
                    { employeeCode: searchRegex }
                ];
            }

            // 2. Build the Aggregation Pipeline
            const pipeline: PipelineStage[] = [
                // Stage 1: Filter Attendance documents for today
                { $match: initialMatch },

                // Stage 2: Join with the Employee collection to get Dept, Role, and Avatar
                {
                    $lookup: {
                        from: 'employees', // Must exactly match your MongoDB collection name!
                        localField: 'employeeId',
                        foreignField: '_id',
                        as: 'employeeData'
                    }
                },

                // Stage 3: Unwind the array created by $lookup
                {
                    $unwind: {
                        path: '$employeeData',
                        preserveNullAndEmptyArrays: true // Keep attendance even if employee doc is missing
                    }
                }
            ];

            // Stage 4: Post-Lookup Match (If filtering by Department)
            if (filters.department) {
                pipeline.push({
                    $match: {
                        'employeeData.department': filters.department
                    }
                });
            }

            // Stage 5: Project exactly what the React Frontend expects
            pipeline.push({
                $project: {
                    _id: 0,
                    attendanceId: '$_id',
                    employeeId: 1,
                    employeeCode: 1,
                    employeeName: 1,
                    inTime: 1,
                    outTime: 1,
                    status: 1,
                    workMode: 1,
                    isLate: 1,
                    lateMinutes: 1,
                    // Pulling from joined Employee Data
                    department: { $ifNull: ['$employeeData.department', 'Unassigned'] },
                    designation: { $ifNull: ['$employeeData.position', 'Employee'] },
                    avatar: { $ifNull: ['$employeeData.profileImageUrl', ''] }
                }
            });

            // Stage 6: Sort logically (e.g., newest punches first)
            pipeline.push({ $sort: { inTime: -1 } });

            // 3. Execute Pipeline
            const roster = await this.attendanceModel.aggregate(pipeline).exec();

            return roster;

        } catch (error) {
            console.error('Database getLiveRoster failure:', error);
            throw new InternalServerErrorException('Failed to fetch the live attendance roster');
        }
    }

    async getPendingCorrectionsCount(): Promise<number> {
        try {
            // Count documents where correctionStatus is exactly 'Pending'
            const count = await this.attendanceModel.countDocuments({
                correctionStatus: 'Pending'
            }).exec();

            return count;
        } catch (error) {
            console.error('Database getPendingCorrectionsCount failure:', error);
            throw new InternalServerErrorException('Failed to count pending corrections');
        }
    }

    async getCorrections(status: string = 'Pending') {
        try {
            // If status is 'Resolved', fetch BOTH Approved and Rejected requests
            const matchCondition = status === 'Resolved'
                ? { correctionStatus: { $in: ['Approved', 'Rejected'] } }
                : { correctionStatus: 'Pending' };

            const pipeline: PipelineStage[] = [
                { $match: matchCondition },

                // Join Employee Data
                {
                    $lookup: {
                        from: 'employees',
                        localField: 'employeeId',
                        foreignField: '_id',
                        as: 'employeeData'
                    }
                },
                {
                    $unwind: {
                        path: '$employeeData',
                        preserveNullAndEmptyArrays: true
                    }
                },

                // Project exactly what the UI needs
                {
                    $project: {
                        _id: 0,
                        attendanceId: '$_id',
                        date: 1,

                        // 🟢 NEW: Pass the actual resolution status to the frontend
                        resolutionStatus: '$correctionStatus',

                        // Employee Info
                        employeeName: 1,
                        employeeCode: 1,
                        department: { $ifNull: ['$employeeData.department', 'Unassigned'] },
                        avatar: { $ifNull: ['$employeeData.profileImageUrl', ''] },

                        // Original Times
                        originalInTime: '$inTime',
                        originalOutTime: '$outTime',
                        originalStatus: '$status',

                        // Requested Times
                        requestedInTime: '$activeCorrectionRequest.requestedInTime',
                        requestedOutTime: '$activeCorrectionRequest.requestedOutTime',
                        requestedStatus: '$activeCorrectionRequest.requestedStatus',
                        reason: '$activeCorrectionRequest.reason',
                        proofUrl: '$activeCorrectionRequest.proofUrl',
                        requestedOn: '$activeCorrectionRequest.requestedOn',
                    }
                },
                // Sort by requested date (Newest first is usually better for history)
                { $sort: { requestedOn: -1 } }
            ];

            return await this.attendanceModel.aggregate(pipeline).exec();
        } catch (error) {
            console.error('Database getCorrections failure:', error);
            throw new InternalServerErrorException('Failed to fetch corrections');
        }
    }

    async approveCorrection(attendanceId: string, adminId: string, remark: string = 'Approved by HR') {
        const record = await this.attendanceModel.findById(attendanceId);

        if (!record) throw new NotFoundException('Attendance record not found');

        if (record.correctionStatus !== 'Pending' || !record.activeCorrectionRequest) {
            throw new BadRequestException('No pending correction request found for this record');
        }

        const request = record.activeCorrectionRequest!;

        // 1. Apply requested corrections safely
        if (request.requestedInTime) record.inTime = request.requestedInTime;
        if (request.requestedOutTime) record.outTime = request.requestedOutTime;
        if (request.requestedStatus) record.status = request.requestedStatus;

        // 2. ─── LATE MINUTES CALCULATION MATRIX ───
        if (record.inTime) {
            // Dynamically create the 10:00:00 AM buffer limit for the specific historical date
            // Format: YYYY-MM-DDT10:00:00+05:30 (Forces standard IST time evaluation)
            const bufferLimit = new Date(`${record.date}T10:00:00+05:30`);

            record.isLate = record.inTime > bufferLimit;
            record.lateMinutes = record.isLate
                ? Math.round((record.inTime.getTime() - bufferLimit.getTime()) / 60000)
                : 0;
        }

        // 3. ─── DURATION & SHIFT STATUS CALCULATION ───
        if (record.inTime && record.outTime) {
            const diffMs = record.outTime.getTime() - record.inTime.getTime();
            const totalMinutes = Math.floor(diffMs / 60000);

            record.totalMinutes = totalMinutes;
            record.totalHours = parseFloat((totalMinutes / 60).toFixed(2));

            const rules = await this.systemConfigService.getShiftRulesForDate(record.date);
            const isHoliday = false; // Add holiday logic if needed

            if (rules.isSunday || isHoliday) {
                if (totalMinutes >= rules.shiftMinutes) {
                    record.status = 'CompOff';
                } else if ((totalMinutes + rules.tenMinuteGrace) >= rules.halfDayHurdle) {
                    record.status = 'HalfCompOff';
                } else {
                    record.status = 'P';
                }
            } else {
                if (totalMinutes >= rules.shiftMinutes) {
                    record.status = 'P';
                } else if ((totalMinutes + rules.tenMinuteGrace) >= rules.halfDayHurdle) {
                    record.status = 'Half';
                } else {
                    record.status = 'A';
                }
            }
        }

        // 4. Finalize the correction action
        record.correctionStatus = 'Approved';
        record.correctionHistory.push({
            action: 'Approved',
            byRole: 'HR',
            byAdminId: new Types.ObjectId(adminId),
            remark: remark,
            timestamp: new Date()
        });

        await record.save();

        // 5. ─── ASYNC NOTIFICATION DISPATCH ───
        try {
            // Fetch the employee's name and FCM token
            const employee = await this.employeeService.getEmployeeById(record.employeeId.toString(), 'name fcmToken');

            if (employee && employee.fcmToken) {
                this.notificationService.sendToEmployee({
                    token: employee.fcmToken,
                    title: "Correction Request Approved ✅",
                    body: `Hi ${employee.name}, your attendance correction for ${record.date} was approved. Remark: ${remark}`,
                    data: {
                        type: "ATTENDANCE_CORRECTION_UPDATE",
                        attendanceId: record._id.toString(),
                        status: "Approved"
                    }
                }).catch(e => console.error("FCM Async Error:", e));
            }
        } catch (e) {
            // Fails gracefully without breaking the HTTP response
            console.error("Attendance correction approval notification dispatch failed:", e);
        }

        return record;
    }

    async rejectCorrection(attendanceId: string, adminId: string, remark: string) {
        const record = await this.attendanceModel.findById(attendanceId);

        if (!record) throw new NotFoundException('Attendance record not found');
        if (record.correctionStatus !== 'Pending') {
            throw new BadRequestException('No pending correction request found for this record');
        }

        // 1. Update Status
        record.correctionStatus = 'Rejected';

        // 2. Push to Audit Trail
        record.correctionHistory.push({
            action: 'Rejected',
            byRole: 'HR',
            byAdminId: new Types.ObjectId(adminId),
            remark: remark,
            timestamp: new Date()
        });

        await record.save();

        // 3. --- ASYNC NOTIFICATION DISPATCH ---
        try {
            // Fetch the employee's name and FCM token using the relation on the attendance record
            const employee = await this.employeeService.getEmployeeById(record.employeeId.toString(), 'name fcmToken');

            if (employee && employee.fcmToken) {
                this.notificationService.sendToEmployee({
                    token: employee.fcmToken,
                    title: "Correction Request Rejected ❌",
                    // Include the exact date and HR's remark in the push notification body
                    body: `Hi ${employee.name}, your attendance correction for ${record.date} was rejected. Reason: ${remark}`,
                    data: {
                        type: "ATTENDANCE_CORRECTION_UPDATE",
                        attendanceId: record._id.toString(),
                        status: "Rejected"
                    }
                }).catch(e => console.error("FCM Async Error:", e));
            }
        } catch (e) {
            // Fails gracefully without breaking the HTTP response
            console.error("Attendance correction notification dispatch failed:", e);
        }

        return record;
    }

    async getHistoricalLedger(query: {
        page: number;
        limit: number;
        search?: string;
        department?: string;
        startDate?: string;
        endDate?: string;
        status?: string;
    }) {
        try {
            const { page = 1, limit = 10, search, department, startDate, endDate, status } = query;
            const skip = (page - 1) * limit;

            // 1. Initial Match Stage (Attendance fields)
            const initialMatch: any = {};

            if (startDate && endDate) {
                initialMatch.date = { $gte: startDate, $lte: endDate };
            } else if (startDate) {
                initialMatch.date = { $gte: startDate };
            } else if (endDate) {
                initialMatch.date = { $lte: endDate };
            }

            if (status) {
                initialMatch.status = status;
            }

            if (search) {
                const searchRegex = new RegExp(search, 'i');
                initialMatch.$or = [
                    { employeeName: searchRegex },
                    { employeeCode: searchRegex }
                ];
            }

            const pipeline: PipelineStage[] = [
                { $match: initialMatch },

                // 2. Lookup Employee Data
                {
                    $lookup: {
                        from: 'employees',
                        localField: 'employeeId',
                        foreignField: '_id',
                        as: 'employeeData'
                    }
                },
                { $unwind: { path: '$employeeData', preserveNullAndEmptyArrays: true } },

                // 3. Post-Lookup Match (Department)
                ...(department ? [{ $match: { 'employeeData.department': department } }] : []),

                // 4. Facet for Pagination & Data Extraction
                {
                    $facet: {
                        metadata: [
                            { $count: 'totalRecords' }
                        ],
                        data: [
                            { $sort: { date: -1, inTime: -1 } }, // Newest first
                            { $skip: skip },
                            { $limit: Number(limit) },
                            {
                                $project: {
                                    _id: 0,
                                    attendanceId: '$_id',
                                    date: 1,
                                    employeeName: 1,
                                    employeeCode: 1,
                                    department: { $ifNull: ['$employeeData.department', 'Unassigned'] },
                                    avatar: { $ifNull: ['$employeeData.profileImageUrl', ''] },
                                    inTime: 1,
                                    outTime: 1,
                                    status: 1,
                                    workMode: 1,
                                    totalHours: 1,
                                    isLate: 1,
                                    lateMinutes: 1,
                                    // EOD Report Fields for the Modal
                                    todayWork: 1,
                                    pendingWork: 1,
                                    issuesFaced: 1
                                }
                            }
                        ]
                    }
                }
            ];

            const result = await this.attendanceModel.aggregate(pipeline).exec();

            const totalRecords = result[0]?.metadata[0]?.totalRecords || 0;
            const totalPages = Math.ceil(totalRecords / limit);

            return {
                data: result[0]?.data || [],
                meta: {
                    totalRecords,
                    totalPages,
                    currentPage: Number(page),
                    limit: Number(limit)
                }
            };

        } catch (error) {
            console.error('Database getHistoricalLedger failure:', error);
            throw new InternalServerErrorException('Failed to fetch historical ledger');
        }
    }


    // ─────────────────────────────────────── HR SEVICES END ──────────────────────────────────────────
}