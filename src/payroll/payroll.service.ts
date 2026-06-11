import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payroll, PayrollDocument } from './schemas/payroll.schema';

//  Import SERVICES instead of Schemas/Models
import { EmployeeService } from '../employee/employee.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';
import { HolidayService } from '../holiday/holiday.service';

import {
    calculateSalarySplit,
    calculatePT,
    calculateProratedAmount
} from '../utils/payroll.helper';
import { GetPayrollListQueryDto } from './dto/get-payroll-list.dto';

@Injectable()
export class PayrollService {
    constructor(
        @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
        private readonly employeeService: EmployeeService,
        private readonly attendanceService: AttendanceService,
        private readonly leaveService: LeaveService,
        private readonly holidayService: HolidayService,
    ) { }

    // ── CORE ENGINE: SHARED PAYROLL CALCULATOR ──
    private async calculatePayrollMetrics(employeeId: string, employee: any, fromDate: Date, toDate: Date) {
        // 1. The denominator for salary math MUST remain the total days in the actual cycle
        const totalCycleDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // Fetch Data Concurrently
        const [attendances, holidays, approvedLeaves] = await Promise.all([
            this.attendanceService.findRecordsInRange(employeeId, fromDate, toDate),
            this.holidayService.findHolidaysInRange(fromDate, toDate),
            this.leaveService.findApprovedLeavesInRange(employeeId, fromDate, toDate)
        ]);

        let present = 0, half = 0, absent = 0, paidLeaveCount = 0, holidayCount = 0, weekOffCount = 0, compOffCount = 0;

        //  NEW: Array to track every single paid date and its reason
        const paidDaysBreakdown: { date: string; type: string; value: number }[] = [];

        // Calculate Effective Start Date based on Joining Date
        const cycleStartDate = new Date(fromDate);
        let joiningDate = cycleStartDate; // Default to cycle start

        if (employee.joiningDate) {
            joiningDate = new Date(employee.joiningDate);
            // If you STILL want to skip the 27th and start on the 28th, uncomment the line below:
            joiningDate.setTime(joiningDate.getTime() + (24 * 60 * 60 * 1000));
        }

        // The loop starts at the cycle start OR the joining date, whichever is LATER
        const effectiveStartDate = joiningDate > cycleStartDate ? joiningDate : cycleStartDate;

        let current = new Date(effectiveStartDate);

        // If they joined AFTER the cycle ended, this loop automatically skips and paidDays = 0
        while (current <= toDate) {
            // 1. Safely check for Sunday in IST
            const istDateString = current.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
            const isSunday = new Date(istDateString).getDay() === 0;

            // 2. Safely extract the exact YYYY-MM-DD string without UTC shifting
            const yyyy = current.getFullYear();
            const mm = String(current.getMonth() + 1).padStart(2, '0');
            const dd = String(current.getDate()).padStart(2, '0');
            const dStr = `${yyyy}-${mm}-${dd}`;

            const isHolid = holidays.some(h => {
                const hDate = h.date instanceof Date ? h.date : new Date(h.date);
                const h_yyyy = hDate.getFullYear();
                const h_mm = String(hDate.getMonth() + 1).padStart(2, '0');
                const h_dd = String(hDate.getDate()).padStart(2, '0');
                return `${h_yyyy}-${h_mm}-${h_dd}` === dStr;
            });

            const record = attendances.find(a => a.date === dStr);

            if (isSunday) {
                weekOffCount++;
                paidDaysBreakdown.push({ date: dStr, type: 'WeekOff', value: 1 });
            } else if (isHolid) {
                holidayCount++;
                paidDaysBreakdown.push({ date: dStr, type: 'Holiday', value: 1 });
            } else if (record) {
                // 1. Full Working Days
                if (record.status === 'P') {
                    present++;
                    paidDaysBreakdown.push({ date: dStr, type: 'Present', value: 1 });
                }
                // 2. Half Days
                else if (record.status === 'Half') {
                    half++;
                    paidDaysBreakdown.push({ date: dStr, type: 'HalfDay', value: 0.5 });
                }
                // 3. EXPLICIT COMP-OFF TRACKING
                else if (record.status === 'Coff' || record.status === 'CompOff') {
                    compOffCount++;
                    paidDaysBreakdown.push({ date: dStr, type: 'CompOff', value: 1 });
                }
                // 4. Standard Approved Leaves
                else if (['Paid', 'Sick', 'Casual', 'Earned'].includes(record.status)) {
                    const hasLeave = approvedLeaves.some(l => {
                        const start = l.startDate instanceof Date ? l.startDate : new Date(l.startDate);
                        const end = l.endDate instanceof Date ? l.endDate : new Date(l.endDate);
                        return current >= start && current <= end;
                    });

                    if (hasLeave) {
                        paidLeaveCount++;
                        paidDaysBreakdown.push({ date: dStr, type: 'PaidLeave', value: 1 });
                    } else {
                        absent++;
                    }
                }
                // 5. Default to Absent for unknown statuses
                else {
                    absent++;
                }
            } else {
                absent++;
            }
            current.setTime(current.getTime() + (24 * 60 * 60 * 1000));
        }

        const paidDays = present + compOffCount + (half * 0.5) + paidLeaveCount + weekOffCount + holidayCount;
        const leavesTaken = absent + (half * 0.5);

        // Apply Math via Helpers
        const totalCTC = employee.salary || 0;
        const structure = employee.salaryStructure || { basicPercentage: 100, allowancePercentage: 0 };
        const { basic, allowances } = calculateSalarySplit(totalCTC, structure);

        const pr_basic = calculateProratedAmount(basic, totalCycleDays, paidDays);
        const pr_allowances = calculateProratedAmount(allowances, totalCycleDays, paidDays);
        const totalGross = pr_basic + pr_allowances;

        const professionalTax = calculatePT(basic, employee.gender, toDate.getUTCMonth());
        const netSalary = Math.max(0, totalGross - professionalTax);

        return {
            totalCycleDays,
            // workingDays is strictly the days they were SUPPOSED to work since they joined
            workingDays: (Math.floor((toDate.getTime() - effectiveStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1) - weekOffCount - holidayCount,
            presentDays: present,
            compOffDays: compOffCount,
            halfDays: half,
            absentDays: absent,
            paidLeaves: paidLeaveCount,
            unpaidLeaves: absent,
            holidays: holidayCount,
            weekOffs: weekOffCount,
            leavesTaken,
            paidDays,
            paidDaysBreakdown, 
            earnings: {
                basic: pr_basic,
                allowances: pr_allowances,
                totalGross: parseFloat(totalGross.toFixed(2))
            },
            deductions: {
                professionalTax,
                taxDeductedAtSource: 0,
                other: 0,
                totalDeductions: professionalTax
            },
            netSalary: parseFloat(netSalary.toFixed(2))
        };
    }

    async generateSingleEmployeePayroll(
        employeeId: string,
        fromDate: Date,
        toDate: Date,
        targetMonth: number,
        targetYear: number,
        processedById: string
    ) {
        // 1. Fetch Employee using their dedicated service
        const employee = await this.employeeService.getEmployeeById(employeeId);
        if (!employee) throw new NotFoundException('Employee not found');

        const totalCycleDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // 2. Fetch Data Concurrently using exported Service methods
        const [attendances, holidays, approvedLeaves] = await Promise.all([
            this.attendanceService.findRecordsInRange(employeeId, fromDate, toDate),
            this.holidayService.findHolidaysInRange(fromDate, toDate),
            this.leaveService.findApprovedLeavesInRange(employeeId, fromDate, toDate)
        ]);

        let present = 0;
        let half = 0;
        let absent = 0;
        let paidLeaveCount = 0;
        let holidayCount = 0;
        let weekOffCount = 0;

        let current = new Date(fromDate);
        while (current <= toDate) {
            const isSunday = current.getUTCDay() === 0;
            const dStr = current.toISOString().split('T')[0]; // Yields "YYYY-MM-DD"

            //  Normalize holiday date comparison safely
            const isHolid = holidays.some(h => {
                const hDate = h.date instanceof Date ? h.date : new Date(h.date);
                return hDate.toISOString().split('T')[0] === dStr;
            });

            //  FIXED: a.date is already a YYYY-MM-DD string, match it directly!
            const record = attendances.find(a => a.date === dStr);

            if (isSunday) {
                weekOffCount++;
            } else if (isHolid) {
                holidayCount++;
            } else if (record) {
                if (record.status === 'P' || record.status === 'Coff') present++;
                else if (record.status === 'Half') half++;
                else if (['Paid', 'Sick', 'Casual', 'Earned', 'CompOff'].includes(record.status)) {
                    //  Safely compare leave boundaries
                    const hasLeave = approvedLeaves.some(l => {
                        const start = l.startDate instanceof Date ? l.startDate : new Date(l.startDate);
                        const end = l.endDate instanceof Date ? l.endDate : new Date(l.endDate);
                        return current >= start && current <= end;
                    });
                    if (hasLeave) paidLeaveCount++;
                    else absent++;
                } else {
                    absent++;
                }
            } else {
                absent++;
            }
            current.setUTCDate(current.getUTCDate() + 1);
        }

        const paidDays = present + (half * 0.5) + paidLeaveCount + weekOffCount + holidayCount;
        const leavesTaken = absent + (half * 0.5);

        // 3. Apply Policy & Math via Helpers
        const totalCTC = employee.salary || 0;
        const structure = employee.salaryStructure || { basicPercentage: 100, allowancePercentage: 0 };
        const { basic, allowances } = calculateSalarySplit(totalCTC, structure);

        const pr_basic = calculateProratedAmount(basic, totalCycleDays, paidDays);
        const pr_allowances = calculateProratedAmount(allowances, totalCycleDays, paidDays);
        const totalGross = pr_basic + pr_allowances;

        const professionalTax = calculatePT(basic, employee.gender, toDate.getUTCMonth());

        const netSalary = Math.max(0, totalGross - professionalTax);

        // 4. Save locally
        const payload = {
            employeeCode: employee.employeeCode,
            employeeName: employee.name,
            month: targetMonth,
            year: targetYear,
            fromDate,
            toDate,
            totalCycleDays,
            workingDays: totalCycleDays - weekOffCount - holidayCount,
            presentDays: present,
            halfDays: half,
            absentDays: absent,
            paidLeaves: paidLeaveCount,
            unpaidLeaves: absent,
            holidays: holidayCount,
            weekOffs: weekOffCount,
            leavesTaken,
            paidDays,
            earnings: {
                basic: pr_basic,
                allowances: pr_allowances,
                totalGross: parseFloat(totalGross.toFixed(2))
            },
            deductions: {
                professionalTax,
                taxDeductedAtSource: 0,
                other: 0,
                totalDeductions: professionalTax
            },
            netSalary: parseFloat(netSalary.toFixed(2)),
            status: 'Processed',
            processedBy: new Types.ObjectId(processedById)
        };

        return await this.payrollModel.findOneAndUpdate(
            { employeeId: new Types.ObjectId(employeeId), month: targetMonth, year: targetYear },
            { $set: payload },
            { upsert: true, new: true }
        );
    }

    // Add this method inside your PayrollService class
    async getPayrollList(user: any, queryDto: GetPayrollListQueryDto) {
        const {
            month,
            year,
            status,
            startDate,
            endDate,
            employeeId,
            self,
            page = '1',
            limit = '10'
        } = queryDto;

        const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(user.role);
        const findQuery: any = {};

        if (self === 'true' || !isManagement) {
            // Prioritize user.employeeId so it matches the ID stored in the payroll collection
            const targetId = user.employeeId || user.id || user._id;
            findQuery.employeeId = new Types.ObjectId(targetId);
        } else if (employeeId) {
            // Management looking up a specific employee
            findQuery.employeeId = new Types.ObjectId(employeeId);
        }

        // 2. Date Scope Filters
        if (startDate && endDate) {
            const start = new Date(`${startDate}T00:00:00Z`);
            const end = new Date(`${endDate}T23:59:59Z`);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                findQuery.fromDate = { $lte: end };
                findQuery.toDate = { $gte: start };
            }
        } else if (month && year) {
            findQuery.month = Number(month);
            findQuery.year = Number(year);
        }

        // 3. Status Filter (Draft, Processed, Paid)
        if (status) {
            findQuery.status = status;
        }

        // 4. Pagination Setup
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.max(1, parseInt(limit, 10));
        const skip = (pageNum - 1) * limitNum;

        // 5. Query DB Concurrently
        const [payrolls, total] = await Promise.all([
            this.payrollModel.find(findQuery)
                .populate('employeeId', 'name employeeCode department position joiningDate panNumber bankName accountNumber ifsc branch')
                .sort({ employeeCode: 1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
                .exec(),
            this.payrollModel.countDocuments(findQuery).exec()
        ]);

        const totalPages = Math.ceil(total / limitNum);

        // 6. Return standard structured response payload expected by your frontend
        return {
            payrolls,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages
            }
        };
    }

    // ── EMPLOYEE FACING: REAL-TIME PAYROLL SIMULATOR ──
    async previewEmployeePayroll(employeeId: string, fromDate: Date, toDate: Date) {
        const employee = await this.employeeService.getEmployeeById(employeeId);
        if (!employee) throw new NotFoundException('Employee not found');

        const metrics = await this.calculatePayrollMetrics(employeeId, employee, fromDate, toDate);

        return {
            _id: `sim_${new Date().getTime()}`,
            employeeId: employee._id,
            employeeCode: employee.employeeCode,
            employeeName: employee.name,
            fromDate,
            toDate,
            ...metrics, // Spreads all the math cleanly
            status: 'Simulation',
            isSimulation: true
        };
    }
}