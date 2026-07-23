import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { EmployeeService } from '../employee/employee.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';

@Injectable()
export class ManagementService {

    constructor(
        private employeeService: EmployeeService,
        private attendanceService: AttendanceService,
        private readonly leaveService: LeaveService,
    ) { }


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
