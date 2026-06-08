import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendanceDocument } from './schemas/attendance.schema';
import { HolidayService } from '../holiday/holiday.service';
import { getDistanceInMeters } from './utils/geo.util';
import { CheckInDto, CheckOutDto } from './dto/punch.dto';
import { EmployeeService } from '../employee/employee.service';
import { createTodayISTThreshold, getIST } from '../utils/time.utils';
import { TrackLocationDto } from './dto/track-location.dto';

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

    private getFormattedDateStringIST(date: Date): string {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date);
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
            const shiftMinutes = dayOfWeek === 6 ? 420 : 510; // Sat = 7 hrs, Mon-Fri = 8.5 hrs

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

            if (isSunday || isHoliday) {
                // STRICT COFF ENFORCEMENT: ALL OR NOTHING
                if (totalMinutes >= shiftMinutes) {
                    attendance.status = 'Coff'; // Full Comp Off Earned
                } else {
                    attendance.status = 'P';
                }
            } else {
                // Normal Working Day Evaluation
                const halfDayHurdle = shiftMinutes / 2;
                const tenMinuteGrace = 10;

                if (totalMinutes >= shiftMinutes) {
                    attendance.status = 'P'; // Full Day
                }
                // GRACE PERIOD APPLIED HERE
                // Example: If halfDayHurdle is 255 mins, and they worked 246 mins:
                // 246 + 10 = 256 -> (256 >= 255) evaluates to TRUE. They get the Half Day!
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

            // Safely map frontend IDs to MongoDB ObjectIds
            if (dto.reportParticipants && dto.reportParticipants.length > 0) {
                attendance.reportParticipants = dto.reportParticipants.map(
                    (id) => new Types.ObjectId(id)
                );
            }

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

            // 14. SAVE WITH SESSION AND COMMIT
            await attendance.save({ session }); // Critical: pass the session to the save method
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

    async getReportingManagers(employeeId: string) {
        // 1. Get the employee and their manager array
        const employee = await this.employeeService.getEmployeeById(employeeId, 'managerIds');

        // 2. Pass the array to your optimized fetcher
        const managers = await this.employeeService.getReportingManagers(employee.managerIds);

        return managers;

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
}