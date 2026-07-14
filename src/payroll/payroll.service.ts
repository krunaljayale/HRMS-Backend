import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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
import { ReimbursementService } from '../reimbursement/reimbursement.service';

@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(Payroll.name) private payrollModel: Model<PayrollDocument>,
    private readonly employeeService: EmployeeService,
    private readonly attendanceService: AttendanceService,
    private readonly leaveService: LeaveService,
    private readonly holidayService: HolidayService,
    private readonly reimbursementService: ReimbursementService,
  ) { }

  // ── CORE ENGINE: SHARED PAYROLL CALCULATOR ──
  private async calculatePayrollMetrics(
    employeeId: string,
    employee: any,
    fromDate: Date,
    toDate: Date,
    existingPayrollId?: Types.ObjectId,
    session?: ClientSession
  ) {
    const totalCycleDays = Math.floor(
      (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

    // Calculate Effective Start Date (Joining Date Logic)
    const cycleStartDate = new Date(fromDate);
    let joiningDate = cycleStartDate;
    if (employee.joiningDate) {
      joiningDate = new Date(employee.joiningDate);
    }
    const effectiveStartDate = joiningDate > cycleStartDate ? joiningDate : cycleStartDate;

    // ─── THE FIX: ADD A 4-DAY BUFFER TO CHECK EDGE-CASE SANDWICHES ───
    const bufferFrom = new Date(effectiveStartDate);
    bufferFrom.setDate(bufferFrom.getDate() - 4);

    const bufferTo = new Date(toDate);
    bufferTo.setDate(bufferTo.getDate() + 4);

    // Fetch Data Concurrently using the BUFFERS + Reimbursements + Session
    const [attendances, holidays, approvedLeaves, unpaidClaims] = await Promise.all([
      this.attendanceService.findRecordsInRange(employeeId, bufferFrom, bufferTo, session),
      this.holidayService.findHolidaysInRange(bufferFrom, bufferTo, session),
      this.leaveService.findApprovedLeavesInRange(employeeId, bufferFrom, bufferTo, session),
      this.reimbursementService.getClaimsForPayrollCalculation(employeeId, toDate, existingPayrollId, session),
    ]);

    let present = 0,
      half = 0,
      absent = 0,
      paidLeaveCount = 0,
      holidayCount = 0,
      weekOffCount = 0,
      compOffCount = 0;
    const paidDaysBreakdown: { date: string; type: string; value: number }[] = [];

    const cycleFromStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(effectiveStartDate);
    const cycleToStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(toDate);

    // --- PHASE 1: BUILD THE TIMELINE (Including Buffers) ---
    const timeline: { date: string; status: string; isFreeDay: boolean }[] = [];
    let scheduledFreeDays = 0;
    let current = new Date(bufferFrom);

    while (current <= bufferTo) {
      const dStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(current);

      const isSunday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
      }).format(current) === 'Sun';

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

      const record = attendances.find((a) => a.date === dStr);

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
      } else if (isHolid) {
        dayStatus = 'Holiday';
        isFreeDay = true;
      } else {
        if (record && record.status === 'P') {
          dayStatus = 'Present';
        } else if (record && record.status === 'Half') {
          if (leaveRecord && leaveRecord.leaveCategory === 'Paid') {
            dayStatus = 'HalfPresent_HalfPaidLeave';
          } else {
            dayStatus = 'HalfDay';
          }
        } else if (record && record.status === 'CompOff') {
          dayStatus = 'CompOff';
        } else if (record && record.status === 'HalfCompOff') {
          dayStatus = 'HalfCompOff';
        } else if (leaveRecord) {
          if (leaveRecord.leaveCategory === 'Paid') {
            dayStatus = leaveRecord.isHalfDay ? 'HalfPaidLeave_HalfAbsent' : 'PaidLeave';
          } else {
            dayStatus = 'Absent';
          }
        } else {
          dayStatus = 'Absent';
        }
      }

      // Only count scheduled free days if they fall strictly within the active pay cycle
      if (isFreeDay && dStr >= cycleFromStr && dStr <= cycleToStr) {
        scheduledFreeDays++;
      }

      timeline.push({ date: dStr, status: dayStatus, isFreeDay });
      current.setTime(current.getTime() + 24 * 60 * 60 * 1000);
    }

    // --- PHASE 2: THE SANDWICH SCANNER ---
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

        if (leftBuilder && rightBuilder) {
          timeline[i].status = 'Sandwiched';
        }
      }
    }

    // --- PHASE 3: TALLY THE RESULTS ---
    for (const day of timeline) {
      if (day.date < cycleFromStr || day.date > cycleToStr) {
        continue;
      }

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
        half++;
        paidDaysBreakdown.push({ date: day.date, type: 'HalfCompOff', value: 0.5 });
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
      } else if (day.status === 'HalfPresent_HalfPaidLeave') {
        half++;
        paidLeaveCount += 0.5;
        paidDaysBreakdown.push({ date: day.date, type: 'HalfDay', value: 0.5 });
        paidDaysBreakdown.push({ date: day.date, type: 'PaidLeave', value: 0.5 });
      } else if (day.status === 'HalfPaidLeave_HalfAbsent') {
        paidLeaveCount += 0.5;
        absent += 0.5;
        paidDaysBreakdown.push({ date: day.date, type: 'PaidLeave', value: 0.5 });
      } else if (day.status === 'Absent' || day.status === 'Sandwiched') {
        absent++;
        paidDaysBreakdown.push({ date: day.date, type: day.status, value: 0 });
      }
    }

    // --- PHASE 4: APPLY MATH (Updated for Reimbursements) ---
    const paidDays =
      present +
      compOffCount +
      half * 0.5 +
      paidLeaveCount +
      weekOffCount +
      holidayCount;
    const leavesTaken = absent + half * 0.5;

    const basic = employee.salary || 0;

    // 1. Only Prorate the Basic Salary
    const pr_basic = calculateProratedAmount(basic, totalCycleDays, paidDays);

    // 2. Allowance remains a flat amount (not calculated per day)
    const flat_allowance = employee.fixedAllowance || 0;

    // 3. Tally Reimbursements (Non-taxable addition)
    const totalReimbursementAmount = unpaidClaims.reduce(
      (sum, claim) => sum + (claim.amount || 0),
      0
    );
    const reimbursementClaimIds = unpaidClaims.map(claim => claim._id);

    // 4. Calculate PT based STRICTLY on the raw 'basic' salary, ignoring the allowance entirely
    const professionalTax = calculatePT(
      basic,
      employee.gender,
      toDate.getUTCMonth(),
    );

    // 5. Calculate Gross and Net
    const totalGross = pr_basic + flat_allowance;

    // Add reimbursements AFTER taxes, as they are tax-exempt refunds to the employee
    const netSalary = Math.max(0, totalGross - professionalTax) + totalReimbursementAmount;

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
        basic: basic,
        allowances: flat_allowance,
        reimbursements: totalReimbursementAmount,
        totalGross: parseFloat(totalGross.toFixed(2)),
      },
      deductions: {
        professionalTax,
        taxDeductedAtSource: 0,
        other: 0,
        totalDeductions: professionalTax,
      },
      netSalary: parseFloat(netSalary.toFixed(2)),
      metadata: {
        reimbursementClaimIds
      }
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
    // 1. Initialize the Database Session
    const session = await this.payrollModel.db.startSession();
    session.startTransaction();

    try {
      // 2. Fetch Employee (passing session ensures consistency if read during transaction)
      const employee = await this.employeeService.getEmployeeById(employeeId, undefined, session);
      if (!employee) {
        throw new NotFoundException(`Employee ${employeeId} not found`);
      }

      // 3. ─── PRE-CHECK: AVOID THE RECALCULATION TRAP ───
      const existingPayroll = await this.payrollModel.findOne(
        {
          employeeId: new Types.ObjectId(employeeId),
          month: targetMonth,
          year: targetYear,
        },
        null,
        { session }, // Bind to session
      );

      if (existingPayroll) {
        await this.reimbursementService.resetClaimsByPayrollId(existingPayroll._id, session);
      }

      // 4. Calculate all metrics
      // NOTE: If this method performs any DB reads/writes, you MUST pass the session to it
      // so it executes within the same transaction context.
      const metrics = await this.calculatePayrollMetrics(
        employeeId,
        employee,
        fromDate,
        toDate,
        undefined,
        session, // Pass session here
      );

      // 5. Prepare the payload matching the Payroll Schema
      const payload = {
        employeeCode: employee.employeeCode,
        employeeName: employee.name,
        month: targetMonth,
        year: targetYear,
        fromDate,
        toDate,

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
        compOffDays: metrics.compOffDays,
        paidDaysBreakdown: metrics.paidDaysBreakdown,

        earnings: metrics.earnings,
        deductions: metrics.deductions,
        netSalary: metrics.netSalary,

        status: 'Processed',
        processedBy: new Types.ObjectId(processedById),
      };

      // 6. Save to Database
      const savedPayroll = await this.payrollModel.findOneAndUpdate(
        {
          employeeId: new Types.ObjectId(employeeId),
          month: targetMonth,
          year: targetYear,
        },
        { $set: payload },
        { upsert: true, returnDocument: 'after', session }, // Bind to session
      );

      // 7. ─── POST-SAVE TRIGGER: LINK REIMBURSEMENTS ───
      if (metrics.metadata?.reimbursementClaimIds?.length > 0) {
        await this.reimbursementService.markClaimsAsPaid(
          metrics.metadata.reimbursementClaimIds,
          savedPayroll._id,
          session, // Bind to session
        );
      }

      // 8. Commit the transaction if everything succeeded
      await session.commitTransaction();
      return savedPayroll;

    } catch (error) {
      // Abort the transaction if ANY operation fails
      await session.abortTransaction();
      throw error;
    } finally {
      // End the session to prevent memory leaks
      session.endSession();
    }
  }

  async generateAllEmployeesPayroll(
    fromDate: Date,
    toDate: Date,
    targetMonth: number,
    targetYear: number,
    processedById: string,
  ) {
    const employees = await this.employeeService.getActiveEmployees();

    if (!employees || employees.length === 0) {
      throw new NotFoundException('No active employees found to process payroll.');
    }

    const results = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      errors: [] as { employeeCode: string; error: string }[],
    };

    // console.log(`[Payroll Batch] Starting batch process for ${employees.length} employees...`);

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
        results.failed++;
        results.errors.push({
          employeeCode: emp.employeeCode,
          error: error.message || 'Unknown error occurred',
        });
        console.error(`[Payroll Batch] Failed for ${emp.employeeCode}:`, error.message);
      }
      results.totalProcessed++;
    }

    // console.log(`[Payroll Batch] Completed! Success: ${results.successful}, Failed: ${results.failed}`);
    return results;
  }

  async getPayrollList(user: any, queryDto: GetPayrollListQueryDto) {
    const {
      search,
      startDate,
      endDate,
      employeeId,
      self,
      page = '1',
      limit = '10',
    } = queryDto;

    const findQuery: any = {};

    // 2. Text Search (Matches Name OR Code)
    if (search) {
      findQuery.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ];
    }

    // 3. Role & Identity Scope Filter
    if (self === 'true') {
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

    // 4. Date Scope Filters
    if (startDate && endDate) {
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T23:59:59Z`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        findQuery.fromDate = { $lte: end };
        findQuery.toDate = { $gte: start };
      }
    }

    // 5. Pagination Setup
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.max(1, parseInt(limit as string, 10));
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
        .sort({ employeeCode: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(),
      this.payrollModel.countDocuments(findQuery).exec(),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // 7. --- ENRICHMENT USING YOUR EXISTING METHOD ---
    const enrichedPayrolls = await Promise.all(
      payrolls.map(async (payroll) => {
        // Use your existing method for each payroll item concurrently
        const reimbursementsList = await this.reimbursementService.findPaidClaimsByPayrollId(
          payroll._id as Types.ObjectId
        );

        return {
          ...payroll,
          reimbursementsList,
        };
      })
    );

    // 8. Return standard structured response payload expected by your frontend
    return {
      payrolls: enrichedPayrolls,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    };
  }

  async previewEmployeePayroll(
    employeeId: string,
    fromDate: Date,
    toDate: Date,
  ) {
    const employee = await this.employeeService.getEmployeeById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    // 1. Extract Target Month and Year safely from the toDate
    // toDate in JS is 0-indexed for months, so we add 1 (e.g., July = 6 + 1 = 7)
    const targetMonth = toDate.getMonth() + 1;
    const targetYear = toDate.getFullYear();

    // 2. Query by month and year to bypass exact millisecond timezone mismatches
    const existingPayroll = await this.payrollModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      month: targetMonth,
      year: targetYear
    });

    const metrics = await this.calculatePayrollMetrics(
      employeeId,
      employee,
      fromDate,
      toDate,
      existingPayroll?._id // <-- Pass the ID if it exists
    );

    // --- ENRICHMENT STEP ---
    const reimbursementDetails = metrics.metadata.reimbursementClaimIds.length > 0
      ? await this.reimbursementService.findManyByIds(metrics.metadata.reimbursementClaimIds)
      : [];

    return {
      _id: existingPayroll ? existingPayroll._id : `sim_${new Date().getTime()}`,
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      fromDate,
      toDate,
      ...metrics,
      reimbursementsList: reimbursementDetails,
      status: existingPayroll ? existingPayroll.status : 'Simulation',
      isSimulation: !existingPayroll, // Automatically false if a real document exists
    };
  }

  async getHistoricalPayrollDetails(payrollId: string, requestingEmployeeId: string) {
    // 1. Fetch the payroll document and enforce security check (employeeId must match)
    const payroll = await this.payrollModel.findOne({
      _id: new Types.ObjectId(payrollId),
      employeeId: new Types.ObjectId(requestingEmployeeId)
    })
      // Populate employee details specifically for the transfer/bank UI section
      .populate('employeeId', 'name employeeCode department position bankName accountNumber ifsc panNumber joiningDate')
      .lean()
      .exec();

    if (!payroll) {
      throw new NotFoundException('Payroll statement not found or unauthorized access');
    }

    // 2. Fetch the reimbursement documents tied to this specific payroll
    // (Assuming you injected ReimbursementService in this PayrollService constructor)
    const reimbursementsList = await this.reimbursementService.findPaidClaimsByPayrollId(payroll._id);

    // 3. Construct and return the exact payload the React Native modal expects
    return {
      ...payroll,
      reimbursementsList: reimbursementsList,
      isSimulation: false,
    };
  }
}
