import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  calculateProratedAmount,
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
  ) {}

  // ── CORE ENGINE: SHARED PAYROLL CALCULATOR ──
  private async calculatePayrollMetrics(
    employeeId: string,
    employee: any,
    fromDate: Date,
    toDate: Date,
  ) {
    // 1. The denominator for salary math MUST remain the total days in the actual cycle
    const totalCycleDays =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    // Fetch Data Concurrently
    const [attendances, holidays, approvedLeaves] = await Promise.all([
      this.attendanceService.findRecordsInRange(employeeId, fromDate, toDate),
      this.holidayService.findHolidaysInRange(fromDate, toDate),
      this.leaveService.findApprovedLeavesInRange(employeeId, fromDate, toDate),
    ]);

    let present = 0,
      half = 0,
      absent = 0,
      paidLeaveCount = 0,
      holidayCount = 0,
      weekOffCount = 0,
      compOffCount = 0;
    const paidDaysBreakdown: { date: string; type: string; value: number }[] =
      [];

    // Calculate Effective Start Date (Joining Date Logic)
    const cycleStartDate = new Date(fromDate);
    let joiningDate = cycleStartDate;
    if (employee.joiningDate) {
      joiningDate = new Date(employee.joiningDate);
    }
    const effectiveStartDate =
      joiningDate > cycleStartDate ? joiningDate : cycleStartDate;

    // --- PHASE 1: BUILD THE TIMELINE ---
    const timeline: { date: string; status: string; isFreeDay: boolean }[] = [];
    let scheduledFreeDays = 0; // Tracks absolute free days to keep workingDays math stable
    let current = new Date(effectiveStartDate);

    while (current <= toDate) {
      // Generate the YYYY-MM-DD string strictly in IST to match your new schema
      const dStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(current);

      const isSunday =
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
        }).format(current) === 'Sun';

      // 🛡️ HOLIDAY TIMEZONE FIX: Convert MongoDB Date to IST string before comparing
      const isHolid = holidays.some((h) => {
        const hDate = h.date instanceof Date ? h.date : new Date(h.date);
        const hStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(hDate);
        return hStr === dStr;
      });

      // Exact string match based on your new schema
      const record = attendances.find((a) => a.date === dStr);

      // LEAVE SCHEDULER: Also formatted to IST strings for safe comparison
      const leaveRecord = approvedLeaves.find((l) => {
        const startStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(l.startDate));

        const endStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(l.endDate));

        return dStr >= startStr && dStr <= endStr;
      });

      let dayStatus = 'Absent';
      let isFreeDay = false;

      if (isSunday) {
        dayStatus = 'WeekOff';
        isFreeDay = true;
        scheduledFreeDays++;
      } else if (isHolid) {
        dayStatus = 'Holiday';
        isFreeDay = true;
        scheduledFreeDays++;
      } else {
        // 1. Physically Worked (Full Day)
        if (record && record.status === 'P') {
          dayStatus = 'Present';
        }
        // 2. Physically Worked (Half Day)
        else if (record && record.status === 'Half') {
          // 🛡️ SCHEMA FIX: Using leaveCategory instead of leaveType
          if (leaveRecord && leaveRecord.leaveCategory === 'Paid') {
            dayStatus = 'HalfPresent_HalfPaidLeave';
          } else {
            dayStatus = 'HalfDay';
          }
        }
        // 3. Compensatory Offs
        else if (record && record.status === 'CompOff') {
          dayStatus = 'CompOff';
        } else if (record && record.status === 'HalfCompOff') {
          dayStatus = 'HalfCompOff';
        }
        // 4. No physical presence -> Check Leave Schema strictly for 'Paid'
        else if (leaveRecord) {
          // 🛡️ STRICT PAID LEAVE RULE: Only 'Paid' category generates pay
          if (leaveRecord.leaveCategory === 'Paid') {
            // If they are not physically present, but have a half-day paid leave ticket, they lose the other half
            dayStatus = leaveRecord.isHalfDay
              ? 'HalfPaidLeave_HalfAbsent'
              : 'PaidLeave';
          } else {
            dayStatus = 'Absent'; // Unpaid, Sick, Casual, Other without physical presence = Absent
          }
        }
        // 5. No physical presence, no leave ticket (Record might be 'A', 'L', 'AUTO', or undefined)
        else {
          dayStatus = 'Absent';
        }
      }

      timeline.push({ date: dStr, status: dayStatus, isFreeDay });
      current.setTime(current.getTime() + 24 * 60 * 60 * 1000);
    }

    // --- PHASE 2: THE SANDWICH SCANNER ---
    // Rule: ONLY full days of non-presence can build a bridge.
    // Any status representing physical presence (HalfDay, HalfCompOff, Present, HalfPresent_HalfPaidLeave) is EXCLUDED.
    const bridgeBuilders = [
      'Absent',
      'PaidLeave',
      'CompOff',
      'HalfPaidLeave_HalfAbsent',
    ];

    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].isFreeDay) {
        let leftBuilder = false;
        let rightBuilder = false;

        // Look backwards
        for (let j = i - 1; j >= 0; j--) {
          if (!timeline[j].isFreeDay) {
            if (bridgeBuilders.includes(timeline[j].status)) {
              leftBuilder = true;
            }
            break;
          }
        }

        // Look forwards
        for (let k = i + 1; k < timeline.length; k++) {
          if (!timeline[k].isFreeDay) {
            if (bridgeBuilders.includes(timeline[k].status)) {
              rightBuilder = true;
            }
            break;
          }
        }

        // Penalize the free day ONLY if fully sandwiched
        if (leftBuilder && rightBuilder) {
          timeline[i].status = 'Sandwiched';
        }
      }
    }

    // --- PHASE 3: TALLY THE RESULTS ---
    for (const day of timeline) {
      if (day.status === 'Present') {
        present++;
        paidDaysBreakdown.push({ date: day.date, type: 'Present', value: 1 });
      } else if (day.status === 'HalfDay') {
        half++;
        paidDaysBreakdown.push({ date: day.date, type: 'HalfDay', value: 0.5 });
      } else if (day.status === 'CompOff') {
        compOffCount++;
        paidDaysBreakdown.push({ date: day.date, type: 'CompOff', value: 1 });
      } else if (day.status === 'HalfCompOff') {
        compOffCount += 0.5;
        half++; // The other half was worked
        paidDaysBreakdown.push({
          date: day.date,
          type: 'HalfCompOff',
          value: 0.5,
        });
        paidDaysBreakdown.push({ date: day.date, type: 'HalfDay', value: 0.5 });
      } else if (day.status === 'PaidLeave') {
        paidLeaveCount++;
        paidDaysBreakdown.push({ date: day.date, type: 'PaidLeave', value: 1 });
      } else if (day.status === 'WeekOff') {
        weekOffCount++;
        paidDaysBreakdown.push({ date: day.date, type: 'WeekOff', value: 1 });
      } else if (day.status === 'Holiday') {
        holidayCount++;
        paidDaysBreakdown.push({ date: day.date, type: 'Holiday', value: 1 });
      }
      // ── SPLIT COLLISIONS FOR FRONTEND ACCURACY ──
      else if (day.status === 'HalfPresent_HalfPaidLeave') {
        half++;
        paidLeaveCount += 0.5;
        paidDaysBreakdown.push({ date: day.date, type: 'HalfDay', value: 0.5 });
        paidDaysBreakdown.push({
          date: day.date,
          type: 'PaidLeave',
          value: 0.5,
        });
      } else if (day.status === 'HalfPaidLeave_HalfAbsent') {
        paidLeaveCount += 0.5;
        absent += 0.5;
        paidDaysBreakdown.push({
          date: day.date,
          type: 'PaidLeave',
          value: 0.5,
        });
      } else if (day.status === 'Absent' || day.status === 'Sandwiched') {
        absent++;
      }
    }

    // --- PHASE 4: APPLY MATH ---
    const paidDays =
      present +
      compOffCount +
      half * 0.5 +
      paidLeaveCount +
      weekOffCount +
      holidayCount;
    const leavesTaken = absent + half * 0.5; // Includes full absent days, half deductions, and sandwich deductions

    const totalCTC = employee.salary || 0;
    const structure = employee.salaryStructure || {
      basicPercentage: 100,
      allowancePercentage: 0,
    };

    // Assumes these helpers are defined elsewhere in your class/file
    const { basic, allowances } = calculateSalarySplit(totalCTC, structure);
    const pr_basic = calculateProratedAmount(basic, totalCycleDays, paidDays);
    const pr_allowances = calculateProratedAmount(
      allowances,
      totalCycleDays,
      paidDays,
    );
    const totalGross = pr_basic + pr_allowances;

    const professionalTax = calculatePT(
      basic,
      employee.gender,
      toDate.getUTCMonth(),
    );
    const netSalary = Math.max(0, totalGross - professionalTax);

    return {
      totalCycleDays,
      workingDays:
        Math.floor(
          (toDate.getTime() - effectiveStartDate.getTime()) /
            (1000 * 60 * 60 * 24),
        ) +
        1 -
        scheduledFreeDays,
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
        totalGross: parseFloat(totalGross.toFixed(2)),
      },
      deductions: {
        professionalTax,
        taxDeductedAtSource: 0,
        other: 0,
        totalDeductions: professionalTax,
      },
      netSalary: parseFloat(netSalary.toFixed(2)),
    };
  }

  async generateSingleEmployeePayroll(
    employeeId: string,
    fromDate: Date,
    toDate: Date,
    targetMonth: number,
    targetYear: number,
    processedById: string,
  ) {
    // 1. Fetch Employee
    const employee = await this.employeeService.getEmployeeById(employeeId);
    if (!employee)
      throw new NotFoundException(`Employee ${employeeId} not found`);

    // 2. Calculate all metrics using the robust helper we built earlier
    // (This contains your sandwich rule, prorata math, PT calculation, and breakdowns)
    const metrics = await this.calculatePayrollMetrics(
      employeeId,
      employee,
      fromDate,
      toDate,
    );

    // 3. Prepare the payload matching the Payroll Schema
    const payload = {
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      month: targetMonth,
      year: targetYear,
      fromDate,
      toDate,

      // Unpack the metrics
      totalCycleDays: metrics.totalCycleDays,
      workingDays: metrics.workingDays,
      presentDays: metrics.presentDays,
      halfDays: metrics.halfDays,
      absentDays: metrics.absentDays,
      paidLeaves: metrics.paidLeaves,
      unpaidLeaves: metrics.unpaidLeaves,
      holidays: metrics.holidays,
      weekOffs: metrics.weekOffs,
      leavesTaken: metrics.leavesTaken,
      paidDays: metrics.paidDays,
      compOffDays: metrics.compOffDays, // Required from schema update
      paidDaysBreakdown: metrics.paidDaysBreakdown, // Required from schema update

      earnings: metrics.earnings,
      deductions: metrics.deductions,
      netSalary: metrics.netSalary,

      status: 'Processed',
      processedBy: new Types.ObjectId(processedById),
    };

    // 4. Save to Database (Upsert prevents duplicates for the same month/year)
    return await this.payrollModel.findOneAndUpdate(
      {
        employeeId: new Types.ObjectId(employeeId),
        month: targetMonth,
        year: targetYear,
      },
      { $set: payload },
      { upsert: true, new: true },
    );
  }

  async generateAllEmployeesPayroll(
    fromDate: Date,
    toDate: Date,
    targetMonth: number,
    targetYear: number,
    processedById: string,
  ) {
    // 1. Fetch all ACTIVE employees
    // (Make sure you have a method like this in your EmployeeService)
    const employees = await this.employeeService.getActiveEmployees();

    if (!employees || employees.length === 0) {
      throw new NotFoundException(
        'No active employees found to process payroll.',
      );
    }

    const results = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      errors: [] as { employeeCode: string; error: string }[],
    };

    // 2. Loop sequentially to protect DB limits and catch individual errors
    for (const emp of employees) {
      try {
        await this.generateSingleEmployeePayroll(
          emp._id.toString(),
          fromDate,
          toDate,
          targetMonth,
          targetYear,
          processedById,
        );
        results.successful++;
      } catch (error: any) {
        // If one employee fails, log it and continue to the next
        results.failed++;
        results.errors.push({
          employeeCode: emp.employeeCode,
          error: error.message || 'Unknown error occurred',
        });
      }
      results.totalProcessed++;
    }

    return results;
  }

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
      limit = '10',
    } = queryDto;

    // 1. Permission Check based on Schema Flag
    const isManagement = user.isLeadershipRole === true;

    const findQuery: any = {};

    // 2. Role & Identity Scope Filter
    if (self === 'true' || !isManagement) {
      // Prioritize user.employeeId so it matches the ID stored in the payroll collection
      const targetId = user.employeeId || user.id || user._id;
      if (!Types.ObjectId.isValid(targetId)) {
        throw new BadRequestException('Invalid User ID');
      }
      findQuery.employeeId = new Types.ObjectId(targetId);
    } else if (employeeId) {
      // Management looking up a specific employee
      if (!Types.ObjectId.isValid(employeeId)) {
        throw new BadRequestException('Invalid Employee ID provided in query');
      }
      findQuery.employeeId = new Types.ObjectId(employeeId);
    }

    // 3. Date Scope Filters
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

    // 4. Status Filter (Draft, Processed, Paid)
    if (status) {
      findQuery.status = status;
    }

    // 5. Pagination Setup
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    // 6. Query DB Concurrently
    const [payrolls, total] = await Promise.all([
      this.payrollModel
        .find(findQuery)
        .populate(
          'employeeId',
          'name employeeCode department position joiningDate panNumber bankName accountNumber ifsc branch',
        )
        // Sort descending by creation date (newest payrolls first)
        .sort({ createdAt: -1, employeeCode: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(),
      this.payrollModel.countDocuments(findQuery).exec(),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // 7. Return standard structured response payload expected by your frontend
    return {
      payrolls,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    };
  }

  // ── EMPLOYEE FACING: REAL-TIME PAYROLL SIMULATOR ──
  async previewEmployeePayroll(
    employeeId: string,
    fromDate: Date,
    toDate: Date,
  ) {
    const employee = await this.employeeService.getEmployeeById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const metrics = await this.calculatePayrollMetrics(
      employeeId,
      employee,
      fromDate,
      toDate,
    );

    return {
      _id: `sim_${new Date().getTime()}`,
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      fromDate,
      toDate,
      ...metrics, // Spreads all the math cleanly
      status: 'Simulation',
      isSimulation: true,
    };
  }
}
