import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, InternalServerErrorException, forwardRef, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { LeaveHistory, LeaveHistoryDocument } from './schemas/leave-history.schema';
import { EmployeeService } from '../employee/employee.service';
import { IWorkflowStep } from './interfaces/workflow-step.interface';
import { LeaveLedger, LeaveLedgerDocument } from './schemas/leave-ledger.schema';
import { createTodayISTThreshold, getIST } from '../utils/time.utils';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class LeaveService {
    constructor(
        @InjectModel(LeaveHistory.name) private leaveHistoryModel: Model<LeaveHistoryDocument>,
        @InjectModel(LeaveLedger.name) private leaveLedgerModel: Model<LeaveLedgerDocument>,
        @Inject(forwardRef(() => EmployeeService))
        private readonly employeeService: EmployeeService,
        private readonly notificationService: NotificationService,
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
        const applicantInfo = await this.employeeService.getEmployeeById(applicantId, 'isLeadershipRole managerId name');

        if (!applicantInfo) throw new NotFoundException('Employee not found');

        const generatedRoute = this.buildWorkflowRoute(
            applicantInfo.isLeadershipRole,
            applicantInfo.managerId
        );

        // Map the string IDs to Mongoose ObjectIds securely
        const ledgerObjectIds = dto.consumedLedgerIds && Array.isArray(dto.consumedLedgerIds)
            ? dto.consumedLedgerIds.map((id: string) => new Types.ObjectId(id))
            : [];

        // ── VERIFY TOKEN VALUES & LOCK THE TOKENS ──
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

        // ── ASYNC FIREBASE PUSH NOTIFICATION TO MANAGER ──
        if (applicantInfo.managerId) {
            this.employeeService.getEmployeeById(applicantInfo.managerId.toString(), 'fcmToken name')
                .then((manager) => {
                    if (manager && manager.fcmToken) {
                        this.notificationService.sendToEmployee({
                            token: manager.fcmToken,
                            title: "New Leave Approval Request 📋",
                            body: `${applicantInfo.name} has submitted a ${dto.totalDays} day ${dto.leaveCategory} leave request requiring your approval.`,
                            data: {
                                type: "LEAVE_REQUEST_RECEIVED",
                                leaveId: newLeave._id.toString(),
                                status: "Pending"
                            }
                        }).catch(err => console.error("FCM Async Manager Error:", err));
                    }
                })
                .catch(err => console.error("Failed to fetch manager for background notification:", err));
        }

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

    // ─────────────────────────────────────── HR SEVICES START ──────────────────────────────────────────

    // ── 1. FETCH PENDING LEAVES FOR HR ──
    async getPendingLeavesForHR() {
        const pipeline: PipelineStage[] = [
            { $match: { overallStatus: 'Pending' } },

            // Step 2: The Magic Array Filter
            // This ensures the step at the current index is an HR step AND is Pending
            {
                $match: {
                    $expr: {
                        $let: {
                            vars: {
                                currentStep: { $arrayElemAt: ['$workflowSteps', '$currentStepIndex'] }
                            },
                            in: {
                                $and: [
                                    { $eq: ['$$currentStep.isHRProfileStep', true] },
                                    { $eq: ['$$currentStep.status', 'Pending'] }
                                ]
                            }
                        }
                    }
                }
            },

            // Step 3: Lookup Employee Data
            {
                $lookup: {
                    from: 'employees', // Must match your actual Employee collection name in MongoDB
                    localField: 'employeeId',
                    foreignField: '_id',
                    as: 'employeeData'
                }
            },
            { $unwind: { path: '$employeeData', preserveNullAndEmptyArrays: true } },

            // Step 4: Sort (Oldest requests first so HR clears the backlog)
            { $sort: { createdAt: 1 } },

            // Step 5: Format to match the Frontend `PendingLeaveItem` Interface exactly
            {
                $project: {
                    _id: 0,
                    leaveId: '$_id',
                    employeeName: { $ifNull: ['$employeeData.name', 'Unknown Employee'] },
                    employeeCode: { $ifNull: ['$employeeData.employeeCode', 'N/A'] },
                    department: { $ifNull: ['$employeeData.department', 'Unassigned'] },
                    avatar: { $ifNull: ['$employeeData.profileImageUrl', ''] },
                    leaveCategory: 1,
                    startDate: 1,
                    endDate: 1,
                    totalDays: 1,
                    isHalfDay: 1,
                    halfDayPeriod: 1,
                    reason: 1,
                    appliedOn: '$createdAt'
                }
            }
        ];


        return await this.leaveHistoryModel.aggregate(pipeline).exec();
    }

    // ── 2. THE APPROVAL ENGINE ──
    async approveLeaveStep(leaveId: string, actingProfile: 'Manager' | 'HR' | 'Director', humanId: string) {
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

        // --- UPDATE THE STEP ---
        currentStep.status = 'Approved';
        currentStep.actedById = new Types.ObjectId(humanId);
        currentStep.actedAt = new Date(); // Use getIST() if imported

        // --- ADVANCE THE WORKFLOW ---
        leave.currentStepIndex += 1;

        if (leave.currentStepIndex >= leave.workflowSteps.length) {
            leave.overallStatus = 'Approved';

            // 💰 BURN THE TOKENS AND RETURN "CHANGE" IF NEEDED
            if (leave.consumedLedgerIds && leave.consumedLedgerIds.length > 0) {
                // 1. Fetch the actual tokens being consumed
                const lockedTokens = await this.leaveLedgerModel.find({
                    _id: { $in: leave.consumedLedgerIds }
                });

                // 2. Calculate the mathematical sum of the locked tokens
                const totalTokenValue = lockedTokens.reduce((sum, token) => sum + (token.value || 1), 0);

                // 3. Mark all locked tokens as Consumed to complete the transaction
                await this.leaveLedgerModel.updateMany(
                    { _id: { $in: leave.consumedLedgerIds } },
                    { $set: { status: 'Consumed' } }
                );

                // 4. THE SPLIT LOGIC: Give "Change" back to the employee
                if (totalTokenValue > leave.totalDays) {
                    // Safe decimal math to avoid floating-point weirdness (e.g., 1.0 - 0.5 = 0.5)
                    const refundValue = Number((totalTokenValue - leave.totalDays).toFixed(2));

                    // Use the last token in the array as the "Base Token" to copy metadata from.
                    // This ensures if it was a CompOff, the refund keeps the same expiry date.
                    const baseToken = lockedTokens[lockedTokens.length - 1];

                    // Mint a new fractional token back to the user's active wallet
                    await this.leaveLedgerModel.create({
                        employeeId: leave.employeeId,
                        leaveType: baseToken.leaveType,
                        status: 'Active',
                        value: refundValue, // E.g., 0.5

                        // Preserve original metadata so HR knows where this fraction came from
                        fixedAllowanceMonth: baseToken.fixedAllowanceMonth,
                        earnedFromAttendanceId: baseToken.earnedFromAttendanceId,
                        expiryDate: baseToken.expiryDate
                    });
                }
            }
        }

        leave.markModified('workflowSteps');
        await leave.save();

        // ... (Keep your FCM Notification logic here)

        const employee = await this.employeeService.getEmployeeById(leave.employeeId.toString(), 'fcmToken name');

        if (employee && employee.fcmToken) {
            // We don't await this because we don't want the HTTP response 
            // to wait for Firebase to finish routing the notification.
            this.notificationService.sendToEmployee({
                token: employee.fcmToken,
                title: "Leave Approved ✅",
                body: `Hi ${employee.name}, your ${leave.leaveCategory} leave request has been approved by HR.`,
                data: {
                    type: "LEAVE_UPDATE",
                    leaveId: leave._id.toString(),
                    status: "Approved"
                }
            }).catch(e => console.error("FCM Async Error:", e));
        }
        return leave;
    }

    // ── 3. THE REJECTION ENGINE ──
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
        currentStep.actedAt = new Date(); // Use getIST() if imported
        currentStep.remarks = remarks;

        leave.overallStatus = 'Rejected';

        // 💰 REFUND THE TOKENS TO THE VAULT (Added 'Locked' safety check)
        if (leave.consumedLedgerIds && leave.consumedLedgerIds.length > 0) {
            await this.leaveLedgerModel.updateMany(
                { _id: { $in: leave.consumedLedgerIds }, status: 'Locked' },
                { $set: { status: 'Active' } }
            );
        }

        leave.markModified('workflowSteps');
        await leave.save();

        // 📱 FIREBASE PUSH NOTIFICATION
        const employee = await this.employeeService.getEmployeeById(leave.employeeId.toString(), 'fcmToken name');

        if (employee && employee.fcmToken) {
            // We don't await this because we don't want the HTTP response 
            // to wait for Firebase to finish routing the notification.
            this.notificationService.sendToEmployee({
                token: employee.fcmToken,
                title: "Leave Rejected ❌",
                // Dynamically tell them who rejected it (Manager, HR, or Director)
                body: `Hi ${employee.name}, your ${leave.leaveCategory} leave request has been rejected by ${actingProfile}.`,
                data: {
                    type: "LEAVE_UPDATE",
                    leaveId: leave._id.toString(),
                    status: "Rejected"
                }
            }).catch(e => console.error("FCM Async Error:", e));
        }

        return leave;
    }

    // ── 4. FETCH LEAVES HISTORICAL FOR HR ──
    async getHistoricalLeaves(query: {
        page: number;
        limit: number;
        search?: string;
        department?: string;
        startDate?: string;
        endDate?: string;
        status?: string;
    }) {
        const { page = 1, limit = 10, search, department, startDate, endDate, status } = query;
        const skip = (page - 1) * limit;

        const initialMatch: any = {};

        // Dynamic Status Filtering
        if (status) {
            // If the UI sends a specific status (Pending, Approved, Rejected, Cancelled)
            // Trust the UI and fetch exactly that.
            initialMatch.overallStatus = status;
        } else {
            // If no status is selected in the UI, show HR's completed actions AND all Cancelled leaves
            initialMatch.$or = [
                {
                    workflowSteps: {
                        $elemMatch: {
                            isHRProfileStep: true,
                            status: { $in: ['Approved', 'Rejected'] }
                        }
                    }
                },
                { overallStatus: 'Cancelled' }
            ];
        }

        // Date Overlap Logic: Find leaves that intersect the requested date range
        if (startDate && endDate) {
            initialMatch.startDate = { $lte: new Date(endDate) };
            initialMatch.endDate = { $gte: new Date(startDate) };
        } else if (startDate) {
            initialMatch.endDate = { $gte: new Date(startDate) };
        } else if (endDate) {
            initialMatch.startDate = { $lte: new Date(endDate) };
        }

        const pipeline: any[] = [
            { $match: initialMatch },
            // Lookup Employee Data
            {
                $lookup: {
                    from: 'employees', // Your employee collection name
                    localField: 'employeeId',
                    foreignField: '_id',
                    as: 'employeeData'
                }
            },
            { $unwind: { path: '$employeeData', preserveNullAndEmptyArrays: true } },

            // Post-Lookup Match for Search & Department
            {
                $match: {
                    ...(department ? { 'employeeData.department': department } : {}),
                    ...(search ? {
                        $or: [
                            { 'employeeData.name': new RegExp(search, 'i') },
                            { 'employeeData.employeeCode': new RegExp(search, 'i') }
                        ]
                    } : {})
                }
            },

            // Facet for Pagination
            {
                $facet: {
                    metadata: [{ $count: 'totalRecords' }],
                    data: [
                        // CHANGE THIS LINE: 
                        // Instead of { $sort: { createdAt: -1 } }, use:
                        { $sort: { startDate: -1 } },
                        { $skip: skip },
                        { $limit: Number(limit) },
                        {
                            $project: {
                                _id: 0,
                                leaveId: '$_id',
                                employeeName: { $ifNull: ['$employeeData.name', 'Unknown Employee'] },
                                employeeCode: { $ifNull: ['$employeeData.employeeCode', 'N/A'] },
                                department: { $ifNull: ['$employeeData.department', 'Unassigned'] },
                                avatar: { $ifNull: ['$employeeData.profileImageUrl', ''] },
                                leaveCategory: 1,
                                startDate: 1,
                                endDate: 1,
                                totalDays: 1,
                                isHalfDay: 1,
                                halfDayPeriod: 1,
                                overallStatus: 1,
                                reason: 1,
                                appliedOn: '$createdAt',
                                workflowSteps: 1
                            }
                        }
                    ]
                }
            }
        ];

        const result = await this.leaveHistoryModel.aggregate(pipeline).exec();
        const totalRecords = result[0]?.metadata[0]?.totalRecords || 0;

        return {
            data: result[0]?.data || [],
            meta: {
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: Number(page),
                limit: Number(limit)
            }
        };
    }
    // ─────────────────────────────────────── HR SEVICES END ──────────────────────────────────────────


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

    async countPendingApprovalsForManager(managerId: Types.ObjectId, reportIds: Types.ObjectId[]): Promise<number> {
        return this.leaveHistoryModel.countDocuments({
            employeeId: { $in: reportIds },
            overallStatus: 'Pending',
            $expr: {
                $and: [
                    { $lt: ['$currentStepIndex', { $size: '$workflowSteps' }] },
                    {
                        $eq: [
                            { $arrayElemAt: ['$workflowSteps.approverId', '$currentStepIndex'] },
                            managerId,
                        ],
                    },
                    {
                        $eq: [
                            { $arrayElemAt: ['$workflowSteps.status', '$currentStepIndex'] },
                            'Pending',
                        ],
                    },
                ],
            },
        });
    }

    async getPendingApprovalsForManager(managerId: Types.ObjectId, reportIds: Types.ObjectId[]): Promise<LeaveHistory[]> {
        return this.leaveHistoryModel.find({
            employeeId: { $in: reportIds },
            overallStatus: 'Pending',
            $expr: {
                $and: [
                    { $lt: ['$currentStepIndex', { $size: '$workflowSteps' }] },
                    {
                        $eq: [
                            { $arrayElemAt: ['$workflowSteps.approverId', '$currentStepIndex'] },
                            managerId,
                        ],
                    },
                    {
                        $eq: [
                            { $arrayElemAt: ['$workflowSteps.status', '$currentStepIndex'] },
                            'Pending',
                        ],
                    },
                ],
            },
        })
            // Populates basic applicant info needed for the frontend ApprovalCard
            .populate({
                path: 'employeeId',
                select: 'name position profileImageUrl',
            })
            // Sorts by newest requests first
            .sort({ createdAt: -1 })
            .lean();
    }
    async getResolvedHistoryForManager(
        managerId: Types.ObjectId,
        reportIds: Types.ObjectId[],
        page: number,
        limit: number,
        status?: string
    ): Promise<LeaveHistory[]> {

        // Calculate the number of documents to skip based on the current page
        const skip = (page - 1) * limit;

        // 1. Construct the base query looking for steps the manager took action on
        const query: any = {
            employeeId: { $in: reportIds },
            workflowSteps: {
                $elemMatch: {
                    actedById: managerId,
                    status: { $in: ['Approved', 'Rejected', 'Cancelled'] }
                }
            }
        };

        // 2. If the frontend passes a specific status filter, append it to the query
        if (status && ['Approved', 'Rejected', 'Cancelled'].includes(status)) {
            query.overallStatus = status;
        }

        // 3. Execute the paginated query
        return this.leaveHistoryModel.find(query)
            .populate({
                path: 'employeeId',
                select: 'name position profileImageUrl',
            })
            .sort({ updatedAt: -1 }) // Newest structural actions first
            .skip(skip)              // Skip previous pages
            .limit(limit)            // Limit to chunks (10)
            .lean();
    }

    async approveLeaveStepByManager(leaveId: string, managerId: string) {
        const leave = await this.leaveHistoryModel.findById(leaveId);

        if (!leave) throw new NotFoundException('Leave request not found');
        if (leave.overallStatus !== 'Pending') throw new BadRequestException(`Leave is already completed with status: ${leave.overallStatus}`);

        const currentStep = leave.workflowSteps[leave.currentStepIndex];

        // --- AUTHORIZATION VALIDATION ---
        if (currentStep.approverId?.toString() !== managerId) {
            throw new UnauthorizedException('You are not the assigned manager for this active step.');
        }

        // Target the active index matching your current pointer level
        const activeStep = leave.workflowSteps[leave.currentStepIndex];

        activeStep.status = 'Approved';
        activeStep.actedById = new Types.ObjectId(managerId);
        activeStep.actedAt = new Date();

        // Move pointers forward
        leave.currentStepIndex += 1;

        // Safely mark changes and commit to Mongo cluster
        leave.markModified('workflowSteps');
        await leave.save();

        // --- OPTIONAL: NOTIFY THE NEXT APPROVER / APPLICANT ---
        try {
            const employee = await this.employeeService.getEmployeeById(leave.employeeId.toString(), 'name fcmToken');
            if (employee && employee.fcmToken) {
                this.notificationService.sendToEmployee({
                    token: employee.fcmToken,
                    title: "Leave Status Updated ⏳",
                    body: `Hi ${employee.name}, your manager approved your request. It is now pending final HR confirmation.`,
                    data: {
                        type: "LEAVE_UPDATE",
                        leaveId: leave._id.toString(),
                        status: "ManagerApproved"
                    }
                }).catch(e => console.error("FCM Async Error:", e));
            }
        } catch (e) {
            console.error("Notification dispatch failed:", e);
        }

        return leave;
    }

    async rejectLeaveStepByManager(leaveId: string, managerId: string, remarks: string) {
        if (!remarks || !remarks.trim()) {
            throw new BadRequestException('Rejection remarks are mandatory.');
        }

        const leave = await this.leaveHistoryModel.findById(leaveId);
        if (!leave) throw new NotFoundException('Leave request not found');
        if (leave.overallStatus !== 'Pending') throw new BadRequestException(`Leave is already ${leave.overallStatus}`);

        const currentIndex = leave.currentStepIndex;
        const currentStep = leave.workflowSteps[currentIndex];

        // --- AUTHORIZATION VALIDATION ---
        if (currentStep.approverId?.toString() !== managerId) {
            throw new UnauthorizedException('You are not the assigned manager for this active step.');
        }

        // --- TERMINATE WORKFLOW (Using explicit .set() for deep array safety) ---
        leave.set(`workflowSteps.${currentIndex}.status`, 'Rejected');
        leave.set(`workflowSteps.${currentIndex}.actedById`, new Types.ObjectId(managerId));
        leave.set(`workflowSteps.${currentIndex}.actedAt`, new Date());
        leave.set(`workflowSteps.${currentIndex}.remarks`, remarks.trim());

        leave.overallStatus = 'Rejected';

        //  REFUND THE TOKENS TO THE VAULT (With explicit 'Locked' target safety check)
        if (leave.consumedLedgerIds && leave.consumedLedgerIds.length > 0) {
            await this.leaveLedgerModel.updateMany(
                { _id: { $in: leave.consumedLedgerIds }, status: 'Locked' },
                { $set: { status: 'Active' } }
            );
        }

        // Persist document mutations safely
        await leave.save();

        //  FIREBASE PUSH NOTIFICATION DISPATCH
        try {
            const employee = await this.employeeService.getEmployeeById(leave.employeeId.toString(), 'fcmToken name');

            if (employee && employee.fcmToken) {
                // Fired asynchronously so the HTTP thread context does not stall waiting for external routing APIs
                this.notificationService.sendToEmployee({
                    token: employee.fcmToken,
                    title: "Leave Rejected ❌",
                    body: `Hi ${employee.name}, your ${leave.leaveCategory} leave request has been rejected by Manager.`,
                    data: {
                        type: "LEAVE_UPDATE",
                        leaveId: leave._id.toString(),
                        status: "Rejected"
                    }
                }).catch(e => console.error("FCM Async Error:", e));
            }
        } catch (error) {
            console.error("Failed to execute background notification routing sequence:", error);
        }

        return leave;
    }

}