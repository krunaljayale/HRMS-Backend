import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeaveHistory, LeaveHistoryDocument } from './schemas/leave-history.schema';
import { EmployeeService } from '../employee/employee.service';
import { IWorkflowStep } from './interfaces/workflow-step.interface';
import { LeaveLedger, LeaveLedgerDocument } from './schemas/leave-ledger.schema';
import { CreateCompOffLedgerDto } from './dto/create-comp-off-ledger.dto';
import { getIST } from '../utils/time.utils';
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

        //  VERIFY & LOCK THE TOKENS IMMEDIATELY 
        if (ledgerObjectIds.length > 0) {
            const lockResult = await this.leaveLedgerModel.updateMany(
                {
                    _id: { $in: ledgerObjectIds },
                    status: 'Active', // Ensure they are actually active and not already used
                    employeeId: new Types.ObjectId(applicantId) // Security check
                },
                { $set: { status: 'Locked' } }
            );

            // If the user tried to submit 2 tokens, but only 1 was locked, abort.
            if (lockResult.modifiedCount !== ledgerObjectIds.length) {
                // Revert any partial locks to prevent orphaned tokens
                await this.leaveLedgerModel.updateMany(
                    { _id: { $in: ledgerObjectIds }, status: 'Locked' },
                    { $set: { status: 'Active' } }
                );
                throw new BadRequestException('One or more selected tokens are no longer available or already in use.');
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
            consumedLedgerIds: ledgerObjectIds // Save the vault mappings
        });

        return newLeave;
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
    async createCompOff(employeeId: string, dto: CreateCompOffLedgerDto, session?: any) {
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

}