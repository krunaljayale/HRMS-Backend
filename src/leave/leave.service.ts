import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeaveHistory, LeaveHistoryDocument } from './schemas/leave-history.schema';
import { EmployeeService } from '../employee/employee.service';
import { IWorkflowStep } from './interfaces/workflow-step.interface';
import { LeaveLedger, LeaveLedgerDocument } from './schemas/leave-ledger.schema';
import { CreateCompOffLedgerDto } from './dto/create-comp-off-ledger.dto';
import { createTodayISTThreshold, getIST } from '../utils/time.utils';
import e from 'express';

@Injectable()
export class LeaveService {
    constructor(
        @InjectModel(LeaveHistory.name) private leaveHistoryModel: Model<LeaveHistoryDocument>,
        @InjectModel(LeaveLedger.name) private leaveLedgerModel: Model<LeaveLedgerDocument>,
        private employeeService: EmployeeService,
    ) { }

    // ROUTING ENGINE ──
    private buildWorkflowRoute(isLeadership: boolean, managerId?: Types.ObjectId): IWorkflowStep[] {
        const route: IWorkflowStep[] = [];

        if (isLeadership) {
            route.push({ isHRProfileStep: true, status: 'Pending' });
            route.push({ isDirectorProfileStep: true, status: 'Pending' });
            return route;
        }

        if (managerId) {
            route.push({ approverId: managerId, status: 'Pending' });
        }

        route.push({ isHRProfileStep: true, status: 'Pending' });

        return route;
    }

    // APPLICATION ENGINE (With Token Locking) ──
    async applyForLeave(applicantId: string, dto: any) {
        const applicantInfo = await this.employeeService.getEmployeeById(applicantId, 'isLeadershipRole managerId');

        if (!applicantInfo) throw new NotFoundException('Employee not found');

        const generatedRoute = this.buildWorkflowRoute(
            applicantInfo.isLeadershipRole,
            applicantInfo.managerId
        );

        // Map the string IDs to Mongoose ObjectIds securely
        const ledgerObjectIds = dto.consumedLedgerIds && Array.isArray(dto.consumedLedgerIds)
            ? dto.consumedLedgerIds.map((id: string) => new Types.ObjectId(id))
            : [];

        //  VERIFY TOKEN VALUES & LOCK THE TOKENS
        if (ledgerObjectIds.length > 0) {

            // 1. Fetch the actual tokens so we can read their fractional values
            const tokensToConsume = await this.leaveLedgerModel.find({
                _id: { $in: ledgerObjectIds },
                status: 'Active',
                employeeId: new Types.ObjectId(applicantId)
            });

            // 2. Ensure the user isn't trying to spend tokens that don't belong to them or are already used
            if (tokensToConsume.length !== ledgerObjectIds.length) {
                throw new BadRequestException('One or more selected tokens are no longer available or already in use.');
            }

            // 3. Calculate the mathematical sum of the selected tokens
            const totalTokenValue = tokensToConsume.reduce((sum, token) => sum + (token.value || 1), 0);

            // 4. Validate that the token sum covers the requested days
            if (totalTokenValue < dto.totalDays) {
                throw new BadRequestException(`Insufficient token value. You requested ${dto.totalDays} day(s), but only provided ${totalTokenValue} day(s) worth of tokens.`);
            }

            // 5. Securely Lock the tokens
            const lockResult = await this.leaveLedgerModel.updateMany(
                {
                    _id: { $in: ledgerObjectIds },
                    status: 'Active'
                },
                { $set: { status: 'Locked' } }
            );

            // 6. Concurrency check: If someone clicked submit twice in 1ms, rollback
            if (lockResult.modifiedCount !== ledgerObjectIds.length) {
                await this.leaveLedgerModel.updateMany(
                    { _id: { $in: ledgerObjectIds }, status: 'Locked' },
                    { $set: { status: 'Active' } }
                );
                throw new BadRequestException('Concurrency error: Tokens were modified by another process. Please try again.');
            }
        }

        const newLeave = await this.leaveHistoryModel.create({
            employeeId: new Types.ObjectId(applicantId),
            leaveCategory: dto.leaveCategory,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: dto.totalDays,
            isHalfDay: dto.isHalfDay || false,
            halfDayPeriod: dto.halfDayPeriod || '',
            reason: dto.reason,
            workflowSteps: generatedRoute,
            currentStepIndex: 0,
            overallStatus: 'Pending',
            consumedLedgerIds: ledgerObjectIds
        });

        return newLeave;
    }

    async cancelLeaveRequest(employeeId: string, leaveId: string) {
        // 1. Find the specific leave request
        const leaveRequest = await this.leaveHistoryModel.findOne({
            _id: new Types.ObjectId(leaveId),
            employeeId: new Types.ObjectId(employeeId)
        });

        if (!leaveRequest) {
            throw new NotFoundException('Leave request not found.');
        }

        // 2. Ensure it is actually pending. You cannot cancel an already approved or rejected leave.
        if (leaveRequest.overallStatus !== 'Pending') {
            throw new BadRequestException(`You cannot cancel a leave that is already ${leaveRequest.overallStatus.toLowerCase()}.`);
        }

        // 3. Mark the leave as Cancelled
        leaveRequest.overallStatus = 'Cancelled';

        // Optional: Update workflow steps to reflect cancellation
        if (leaveRequest.workflowSteps && leaveRequest.workflowSteps.length > 0) {
            leaveRequest.workflowSteps[leaveRequest.currentStepIndex].status = 'Cancelled';
        }

        // 4. UNLOCK THE TOKENS
        if (leaveRequest.consumedLedgerIds && leaveRequest.consumedLedgerIds.length > 0) {
            await this.leaveLedgerModel.updateMany(
                { _id: { $in: leaveRequest.consumedLedgerIds }, status: 'Locked' },
                { $set: { status: 'Active' } }
            );
        }

        // 5. Save the updated leave record
        await leaveRequest.save();

        return leaveRequest;
    }

    //  THE APPROVAL ENGINE (With Token Burning) ──
    /**
     * @param leaveId - The ID of the leave request
     * @param actingProfile - How the user is acting ('Manager', 'HR', or 'Director')
     * @param humanId - The ID of the actual employee clicking the button
     */
    async approveLeaveStep(leaveId: string, actingProfile: 'Manager' | 'HR' | 'Director', humanId: string) {
        const leave = await this.leaveHistoryModel.findById(leaveId);

        if (!leave) throw new NotFoundException('Leave request not found');
        if (leave.overallStatus !== 'Pending') throw new BadRequestException(`Leave is already ${leave.overallStatus}`);

        // Get the current step that is waiting for action
        const currentStep = leave.workflowSteps[leave.currentStepIndex];

        // --- AUTHORIZATION CHECK ---
        if (actingProfile === 'Manager' && currentStep.approverId?.toString() !== humanId) {
            throw new UnauthorizedException('You are not the assigned manager for this step.');
        }
        if (actingProfile === 'HR' && !currentStep.isHRProfileStep) {
            throw new UnauthorizedException('This request is not waiting for HR approval.');
        }
        if (actingProfile === 'Director' && !currentStep.isDirectorProfileStep) {
            throw new UnauthorizedException('This request is not waiting for Director approval.');
        }

        // --- UPDATE THE STEP ---
        currentStep.status = 'Approved';
        currentStep.actedById = new Types.ObjectId(humanId);
        currentStep.actedAt = getIST() as Date; // Use centralized time util

        // --- ADVANCE THE WORKFLOW ---
        leave.currentStepIndex += 1;

        // Check if that was the final step in the array
        if (leave.currentStepIndex >= leave.workflowSteps.length) {
            leave.overallStatus = 'Approved';

            //  BURN THE TOKENS 
            if (leave.consumedLedgerIds && leave.consumedLedgerIds.length > 0) {
                await this.leaveLedgerModel.updateMany(
                    { _id: { $in: leave.consumedLedgerIds } },
                    { $set: { status: 'Consumed' } }
                );
            }
        }

        leave.markModified('workflowSteps');
        await leave.save();
        return leave;
    }

    // THE REJECTION ENGINE (With Token Refunds) ──
    async rejectLeave(leaveId: string, actingProfile: 'Manager' | 'HR' | 'Director', humanId: string, remarks?: string) {
        const leave = await this.leaveHistoryModel.findById(leaveId);

        if (!leave) throw new NotFoundException('Leave request not found');
        if (leave.overallStatus !== 'Pending') throw new BadRequestException(`Leave is already ${leave.overallStatus}`);

        const currentStep = leave.workflowSteps[leave.currentStepIndex];

        // --- AUTHORIZATION CHECK ---
        if (actingProfile === 'Manager' && currentStep.approverId?.toString() !== humanId) {
            throw new UnauthorizedException('You are not the assigned manager for this step.');
        }
        if (actingProfile === 'HR' && !currentStep.isHRProfileStep) {
            throw new UnauthorizedException('This request is not waiting for HR approval.');
        }
        if (actingProfile === 'Director' && !currentStep.isDirectorProfileStep) {
            throw new UnauthorizedException('This request is not waiting for Director approval.');
        }

        // --- RECORD THE REJECTION ---
        currentStep.status = 'Rejected';
        currentStep.actedById = new Types.ObjectId(humanId);
        currentStep.actedAt = getIST() as Date;
        currentStep.remarks = remarks; // Optional: Capture why it was rejected

        // Halt the workflow and reject the entire application
        leave.overallStatus = 'Rejected';

        //  REFUND THE TOKENS TO THE VAULT 
        if (leave.consumedLedgerIds && leave.consumedLedgerIds.length > 0) {
            await this.leaveLedgerModel.updateMany(
                { _id: { $in: leave.consumedLedgerIds } },
                { $set: { status: 'Active' } } // Unlocks them
            );
        }

        leave.markModified('workflowSteps');
        await leave.save();
        return leave;
    }

    // LEDGER CREATION & RETRIEVAL ──
    // Notice we added 'value' to the DTO payload
    async createCompOff(employeeId: string, dto: { attendanceId: string; value: number }, session?: any) {
        const employeeExists = await this.employeeService.getEmployeeById(employeeId, '_id');
        if (!employeeExists) {
            throw new NotFoundException('Cannot issue Comp-Off token: Employee not found');
        }

        const expiryDate = getIST() as Date;
        expiryDate.setDate(expiryDate.getDate() + 90);

        const [newCompOffToken] = await this.leaveLedgerModel.create([
            {
                employeeId: new Types.ObjectId(employeeId),
                leaveType: 'CompOff',
                status: 'Active',
                value: dto.value, //  Saves 1 or 0.5
                earnedFromAttendanceId: new Types.ObjectId(dto.attendanceId),
                expiryDate: expiryDate
            }
        ], { session });

        return newCompOffToken;
    }

    async getLeaveLedger(employeeId: string, status?: string) {
        const filter: any = {
            employeeId: new Types.ObjectId(employeeId)
        };

        if (status) {
            filter.status = status;
        }

        return await this.leaveLedgerModel.find(filter).sort({ createdAt: -1 });
    }

    // HISTORY & DASHBOARD ──
    async getEmployeeLeaveHistory(employeeId: string, limit: number = 50) {
        const leaves = await this.leaveHistoryModel
            .find({ employeeId: new Types.ObjectId(employeeId) })
            .populate('consumedLedgerIds')
            .sort({ createdAt: -1 })
            .limit(limit);

        const summary = {
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            cancelled: 0,
        };

        //  Count the statuses (we process this in-memory since the array size per employee is manageable)
        // If you want the summary to reflect ALL leaves (not just the limited 50),
        const allLeavesForSummary = await this.leaveHistoryModel.find({ employeeId: new Types.ObjectId(employeeId) });

        summary.total = allLeavesForSummary.length;
        allLeavesForSummary.forEach((leave) => {
            if (leave.overallStatus === 'Approved') summary.approved++;
            else if (leave.overallStatus === 'Pending') summary.pending++;
            else if (leave.overallStatus === 'Rejected') summary.rejected++;
            else if (leave.overallStatus === 'Cancelled') summary.cancelled++;
        });

        return {
            leaves,
            summary
        };
    }

    // ── PAYROLL ENGINE HELPER: FETCH APPROVED LEAVES IN RANGE ──
    async findApprovedLeavesInRange(employeeId: string, fromDate: Date, toDate: Date): Promise<LeaveHistory[]> {
        return await this.leaveHistoryModel
            .find({
                employeeId: new Types.ObjectId(employeeId),
                overallStatus: 'Approved', // Crucial: Only count fully authorized leaves for payroll calculations
                startDate: { $lte: toDate },
                endDate: { $gte: fromDate },
            })
            .sort({ startDate: 1 })
            .lean(); // plain JS objects for clean map/reduce iterations in the payroll engine
    }

    async getTodayApprovedLeavesCount(): Promise<number> {
        try {
            // 1. Establish precise IST bounding marks for today (00:00:00 to 23:59:59)
            const startOfToday = createTodayISTThreshold('00:00:00');
            const endOfToday = createTodayISTThreshold('23:59:59');

            // 2. Query documents overlapping with today's timeframe
            return await this.leaveHistoryModel.countDocuments({
                overallStatus: 'Approved',
                // Check overlap condition: Leave starts on or before the end of today, 
                // AND leave ends on or after the start of today.
                startDate: { $lte: endOfToday },
                endDate: { $gte: startOfToday },
            });
        } catch (error) {
            console.error('Database getTodayApprovedLeavesCount failure:', error);
            throw new InternalServerErrorException('Failed to calculate employees currently on leave');
        }
    }

}