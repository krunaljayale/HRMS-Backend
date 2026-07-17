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
import * as ExcelJS from 'exceljs';

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

  async exportPayrollToExcel(targetMonth: number, targetYear: number): Promise<Buffer> {
    // 1. Fetch ALL payroll records for the specific cycle without pagination
    // Added { $ne: 'IA11111' } to exclude the Play Store testing account
    const payrolls = await this.payrollModel
      .find({
        month: targetMonth,
        year: targetYear,
        employeeCode: { $ne: 'IA11111' }
      })
      .populate(
        'employeeId',
        'name employeeCode department position bankName accountNumber ifsc branch panNumber joiningDate'
      )
      .sort({ employeeCode: 1 })
      .lean()
      .exec();

    if (!payrolls || payrolls.length === 0) {
      throw new NotFoundException('No payroll records found for the selected cycle.');
    }

    // 2. Initialize Excel Workbook and Worksheet
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Infinity Arthvishva HRMS';
    const worksheet = workbook.addWorksheet('Payroll Summary', {
      views: [{ state: 'frozen', ySplit: 4 }] // Freezes top headers
    });

    // 3. Define Columns mapped exactly to your new schema
    worksheet.columns = [
      { header: 'Sr. No.', key: 'srNo', width: 8 },
      { header: 'Employee No', key: 'empNo', width: 15 },
      { header: 'Employee Name', key: 'empName', width: 25 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'PAN No', key: 'pan', width: 15 },
      { header: 'Bank Name', key: 'bankName', width: 20 },
      { header: 'Bank Account Number', key: 'accNo', width: 22 },
      { header: 'IFSC Code', key: 'ifsc', width: 15 },
      { header: 'Bank Branch', key: 'branch', width: 15 },
      { header: 'Joining Date', key: 'joiningDate', width: 15 },
      { header: 'Total Days', key: 'cycleDays', width: 15 },
      { header: 'Paid Days', key: 'paidDays', width: 12 },
      { header: 'Present Days', key: 'present', width: 12 },
      { header: 'Half Days', key: 'halfDays', width: 12 },
      { header: 'Absent Days', key: 'absent', width: 12 },
      { header: 'Paid Leaves', key: 'paidLeaves', width: 12 },
      { header: 'Unpaid Leaves', key: 'unpaidLeaves', width: 15 },
      { header: 'Comp Off Days', key: 'compOffs', width: 15 },
      { header: 'Holidays', key: 'holidays', width: 12 },
      { header: 'Week Offs', key: 'weekOffs', width: 12 },
      { header: 'Sandwich Days', key: 'sandwichDays', width: 15 },
      { header: 'Basic Salary', key: 'basic', width: 15 },
      { header: 'Allowances', key: 'allowances', width: 15 },
      { header: 'Reimbursements', key: 'reimbursements', width: 15 },
      { header: 'Gross Salary', key: 'gross', width: 15 },
      { header: 'PT Deduction', key: 'pt', width: 15 },
      { header: 'Net Salary', key: 'net', width: 15 },
    ];

    // --- ADDED MAPPING FOR PROPER SUBTITLE ---
    const cycleLabels: Record<number, string> = {
      1: "Dec 21 - Jan 20 (Jan Cycle)",
      2: "Jan 21 - Feb 20 (Feb Cycle)",
      3: "Feb 21 - Mar 20 (Mar Cycle)",
      4: "Mar 21 - Apr 20 (Apr Cycle)",
      5: "Apr 21 - May 20 (May Cycle)",
      6: "May 21 - Jun 20 (Jun Cycle)",
      7: "Jun 21 - Jul 20 (Jul Cycle)",
      8: "Jul 21 - Aug 20 (Aug Cycle)",
      9: "Aug 21 - Sep 20 (Sep Cycle)",
      10: "Sep 21 - Oct 20 (Oct Cycle)",
      11: "Oct 21 - Nov 20 (Nov Cycle)",
      12: "Nov 21 - Dec 20 (Dec Cycle)"
    };
    const cycleText = cycleLabels[targetMonth] || `Month ${targetMonth}`;

    // 4. Inject Title and Subtitle Rows at the top
    worksheet.spliceRows(1, 0, []); // Empty row for spacing
    worksheet.spliceRows(1, 0, [`Payroll Summary: ${cycleText} ${targetYear}`]);
    worksheet.spliceRows(1, 0, ['PAYROLL SUMMARY REPORT']);

    worksheet.mergeCells('A1:AA1'); // Extended merge to cover the new column (AA)
    worksheet.mergeCells('A2:AA2');

    // 5. Populate Data Rows and Calculate Totals
    let totalNetSalary = 0;

    payrolls.forEach((p, index) => {
      const emp: any = p.employeeId || {};
      const joiningDateStr = emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN') : '—';

      totalNetSalary += p.netSalary || 0;

      // Extract exact Sandwich occurrences from the breakdown array
      const sandwichCount = p.paidDaysBreakdown?.filter((day: any) => day.type === 'Sandwiched').length || 0;

      worksheet.addRow({
        srNo: index + 1,
        empNo: emp.employeeCode || p.employeeCode || '—',
        empName: emp.name || p.employeeName || '—',
        designation: emp.position || '—',
        pan: emp.panNumber || '—',
        bankName: emp.bankName || '—',
        accNo: emp.accountNumber || '—',
        ifsc: emp.ifsc || '—',
        branch: emp.branch || '—',
        joiningDate: joiningDateStr,
        cycleDays: p.totalCycleDays,
        paidDays: p.paidDays,
        present: p.presentDays,
        halfDays: p.halfDays,
        absent: p.absentDays,
        paidLeaves: p.paidLeaves,
        unpaidLeaves: p.unpaidLeaves,
        compOffs: p.compOffDays,
        holidays: p.holidays,
        weekOffs: p.weekOffs,
        sandwichDays: sandwichCount,
        basic: p.earnings?.basic || 0,
        allowances: p.earnings?.allowances || 0,
        reimbursements: p.earnings?.reimbursements || 0,
        gross: p.earnings?.totalGross || 0,
        pt: p.deductions?.professionalTax || 0,
        net: p.netSalary || 0,
      });
    });

    // 6. Add Totals Row
    const totalRow = worksheet.addRow({
      srNo: 'Total',
      net: totalNetSalary
    });

    // 7. Styling Definitions (Infinity Arthvishva Theme)
    const fontPrimary = { name: 'Nunito', size: 10 };
    const fontTitle = { name: 'Nunito', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    const fontHeader = { name: 'Nunito', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

    // Title Styling
    const titleCell = worksheet.getCell('A1');
    titleCell.font = fontTitle;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2076C7' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 35;

    // Subtitle Styling
    const subTitleCell = worksheet.getCell('A2');
    subTitleCell.font = { name: 'Nunito', size: 11, bold: true, color: { argb: 'FF145087' } };
    subTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 25;

    // Header Styling (Row 4)
    const headerRow = worksheet.getRow(4);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = fontHeader;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF185E9F' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'medium' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    // ─── RULE 1: SMART TEXT ALIGNMENT ───
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 4 && rowNumber !== totalRow.number) {
        row.eachCell((cell, colNumber) => {
          cell.font = fontPrimary;
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFF8FAFC' } } };

          if (colNumber >= 11) {
            // Numbers and Financials -> Right Aligned
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            if (colNumber >= 22) cell.numFmt = '₹#,##0.00';
          } else if ([1, 2, 5, 8, 10].includes(colNumber)) {
            // Sr. No, Emp No, PAN, IFSC, Joining Date -> Perfectly Centered
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            // Names, Designation, Branch -> Left Aligned for readability
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      }
    });

    // ─── RULE 2: DYNAMIC COLUMN AUTOFIT (Fixed for TS2722) ───
    worksheet.columns.forEach((column) => {
      let maxColumnLength = 0;

      if (column.eachCell) {
        column.eachCell((cell, rowNumber) => {
          if (rowNumber >= 4) { // Only calculate from headers down to data rows
            const formattedValue = cell.numFmt && typeof cell.value === 'number'
              ? `₹${cell.value.toFixed(2)}` // Account for currency rendering length expansion
              : cell.value?.toString() || '';

            if (formattedValue.length > maxColumnLength) {
              maxColumnLength = formattedValue.length;
            }
          }
        });
      }

      // Apply the width with a safe padding buffer (+ 4 characters)
      column.width = Math.max(maxColumnLength + 4, 12);
    });

    // Total Row Styling
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Nunito', size: 10, bold: true, color: { argb: 'FF1CADA3' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      if (colNumber === 27) {
        cell.numFmt = '₹#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
    });

    // 8. Generate Buffer
    return await workbook.xlsx.writeBuffer() as unknown as Buffer;
  }

}
