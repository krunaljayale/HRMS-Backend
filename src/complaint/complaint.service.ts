import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Complaint } from './schemas/complaint.schema';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
import { EmployeeService } from '../employee/employee.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ComplaintService {
    private readonly logger = new Logger(ComplaintService.name);
    constructor(
        @InjectModel(Complaint.name) private complaintModel: Model<Complaint>,
        private readonly employeeService: EmployeeService,
        private readonly notificationService: NotificationService,
    ) { }

    private async fetchComplaintsByStatusList(statuses: string[], search?: string) {
        const filter: any = { status: { $in: statuses } };

        if (search && search.trim() !== '') {
            const regex = new RegExp(search.trim(), 'i');

            // Safely fetch matching employee ObjectIds from EmployeeService
            const employeeIds = await this.employeeService.findEmployeeIdsBySearch(search);

            filter.$or = [
                { title: regex },
                { category: regex },
                { description: regex },
                { employee: { $in: employeeIds } },
            ];
        }

        return await this.complaintModel
            .find(filter)
            .sort({ createdAt: -1 })
            .populate('employee', 'name employeeCode department profileImageUrl')
            .populate('timeline.actionBy', 'name profileImageUrl')
            .exec();
    }

    private async sendComplaintNotification(
        complaint: Complaint,
        updateDto: UpdateComplaintStatusDto,
        previousStatus: string,
    ) {
        try {
            // Fetch employee to get their FCM token
            const employee = await this.employeeService.getEmployeeById(
                complaint.employee.toString(),
                'fcmToken name',
            );

            if (!employee || !(employee as any).fcmToken) {
                this.logger.warn(`No FCM token found for employee ID: ${complaint.employee}`);
                return;
            }

            // Craft dynamic title and message body
            const isStatusChanged = previousStatus !== updateDto.status;
            const title = isStatusChanged
                ? `Complaint Update: ${updateDto.status}`
                : `New Comment on Complaint`;

            let body = `Your complaint "${complaint.title}" has been updated to "${updateDto.status}" by ${updateDto.role}.`;

            if (updateDto.comments && updateDto.comments.trim()) {
                body += ` Note: "${updateDto.comments.trim()}"`;
            }

            // Dispatch via NotificationService
            await this.notificationService.sendToEmployee({
                token: (employee as any).fcmToken,
                title,
                body,
                channelId: 'hrms-complaint-alerts',
                data: {
                    complaintId: complaint._id.toString(),
                    type: 'COMPLAINT_STATUS_UPDATE',
                    status: updateDto.status,
                },
            });
        } catch (error: any) {
            this.logger.error(`Error building push notification payload: ${error.message}`);
        }
    }

    // ─── REUSABLE SEARCH FILTER HELPER ───
    private filterComplaintsBySearch(complaints: any[], searchQuery?: string) {
        if (!searchQuery || !searchQuery.trim()) return complaints;

        const regex = new RegExp(searchQuery.trim(), 'i');

        return complaints.filter((c: any) => {
            const titleMatch = c.title ? regex.test(c.title) : false;
            const categoryMatch = c.category ? regex.test(c.category) : false;
            const empNameMatch = c.employee?.name ? regex.test(c.employee.name) : false;
            const empCodeMatch = c.employee?.employeeCode ? regex.test(c.employee.employeeCode) : false;
            const idMatch = c._id ? regex.test(c._id.toString()) : false;

            return titleMatch || categoryMatch || empNameMatch || empCodeMatch || idMatch;
        });
    }

    // 1. CREATE COMPLAINT
    async create(createComplaintDto: CreateComplaintDto) {
        const employeeObjectId = new Types.ObjectId(createComplaintDto.employee as any);

        const initialTimeline = {
            action: 'Submitted',
            actionBy: employeeObjectId,
            role: 'Employee',
            updatedStatus: 'Pending',
            comments: 'Initial complaint submitted.',
        };

        const newComplaint = new this.complaintModel({
            ...createComplaintDto,
            employee: employeeObjectId,
            status: 'Pending',
            timeline: [initialTimeline],
        });

        return await newComplaint.save();
    }

    async findAll(query: any) {
        const { status, priority, employee } = query;

        // Build query dynamically
        const filter: any = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        if (employee) {
            try {
                filter.employee = new Types.ObjectId(employee);
            } catch (error) {
                throw new BadRequestException('Invalid employee ID format');
            }
        }

        return await this.complaintModel
            .find(filter)
            .sort({ createdAt: -1 })
            .populate('employee', 'name profileImageUrl department')
            .populate('timeline.actionBy', 'name profileImageUrl')
            .exec();
    }

    // 3. GET SINGLE COMPLAINT
    async findOne(id: string) {
        const complaint = await this.complaintModel
            .findById(id)
            .populate('employee', 'name profileImageUrl department')
            .populate('timeline.actionBy', 'name profileImageUrl');

        if (!complaint) throw new NotFoundException('Complaint not found');
        return complaint;
    }

    // 4. UPDATE STATUS & TIMELINE
    async updateStatus(id: string, updateDto: UpdateComplaintStatusDto) {
        const complaint = await this.complaintModel.findById(id);

        if (!complaint) throw new NotFoundException('Complaint not found');

        const previousStatus = complaint.status;

        // 1. Determine the exact action name
        let action = 'Commented';
        if (previousStatus !== updateDto.status) {
            action = updateDto.status; // e.g., "Acknowledged", "In Review", "Resolved", etc.
        } else if (!updateDto.comments || !updateDto.comments.trim()) {
            throw new BadRequestException('Provide a comment or change the status.');
        }

        // 2. Build the new timeline event
        const newTimelineEntry = {
            action,
            actionBy: new Types.ObjectId(updateDto.actionBy),
            role: updateDto.role,
            comments: updateDto.comments || '',
            previousStatus,
            updatedStatus: updateDto.status,
            timestamp: new Date(),
        };

        // 3. Apply status and timeline updates
        complaint.status = updateDto.status;
        complaint.timeline.push(newTimelineEntry as any);

        // Save Director comments specifically if it was a Director taking action
        const normalizedRole = updateDto.role.toUpperCase();
        if (normalizedRole === 'DIRECTOR' && updateDto.comments) {
            complaint.directorComments = updateDto.comments;
        }

        const savedComplaint = await complaint.save();

        // 4. Send Push Notification to Employee (Non-blocking background attempt)
        this.sendComplaintNotification(savedComplaint, updateDto, previousStatus).catch((err) => {
            this.logger.error(`Failed to dispatch complaint push notification: ${err.message}`, err.stack);
        });

        return savedComplaint;
    }

    async withdrawComplaint(employeeId: string, complaintId: string) {
        const complaint = await this.complaintModel.findOne({
            _id: new Types.ObjectId(complaintId),
            employee: new Types.ObjectId(employeeId)
        });

        if (!complaint) {
            throw new NotFoundException('Complaint not found or unauthorized.');
        }

        if (complaint.status !== 'Pending') {
            throw new BadRequestException('Cannot withdraw a complaint that is already being processed.');
        }

        // 1. Create the withdrawal timeline entry
        const withdrawalEntry = {
            action: 'Withdrawn',
            actionBy: new Types.ObjectId(employeeId),
            role: 'Employee',
            previousStatus: complaint.status,
            updatedStatus: 'Withdrawn',
            comments: 'Employee withdrew the complaint.',
            timestamp: new Date(),
        };

        // 2. Update status and push to timeline
        complaint.status = 'Withdrawn';
        complaint.timeline.push(withdrawalEntry as any);

        return await complaint.save();
    }

    async getHrLiveComplaints(search?: string) {
        const liveStatuses = ['Pending', 'Acknowledged', 'In Review'];
        return await this.fetchComplaintsByStatusList(liveStatuses, search);
    }

    async getHistoricalComplaintsForHr(searchQuery?: string) {
        const historicalStatuses = ['Resolved', 'Rejected', 'Withdrawn'];

        // 1. Base query for closed/historical statuses
        const filter: any = {
            status: { $in: historicalStatuses },
        };

        // 2. Fetch and populate references
        let complaints = await this.complaintModel
            .find(filter)
            .populate('employee', 'name employeeCode department profileImageUrl')
            .populate('timeline.actionBy', 'name profileImageUrl')
            .sort({ updatedAt: -1, createdAt: -1 })
            .exec();

        // 3. In-memory filter for populated employee fields & complaint details if searchQuery exists
        if (searchQuery && searchQuery.trim()) {
            const regex = new RegExp(searchQuery.trim(), 'i');

            complaints = complaints.filter((c: any) => {
                const titleMatch = c.title ? regex.test(c.title) : false;
                const categoryMatch = c.category ? regex.test(c.category) : false;
                const empNameMatch = c.employee?.name ? regex.test(c.employee.name) : false;
                const empCodeMatch = c.employee?.employeeCode ? regex.test(c.employee.employeeCode) : false;
                const idMatch = c._id ? regex.test(c._id.toString()) : false;

                return titleMatch || categoryMatch || empNameMatch || empCodeMatch || idMatch;
            });
        }

        return complaints;
    }


    // ─── GET LIVE COMPLAINTS FOR DIRECTOR ───
    async getDirectorLiveComplaints(searchQuery?: string) {
        const liveStatuses = ['Pending', 'Acknowledged', 'In Review'];

        const complaints = await this.complaintModel
            .find({ status: { $in: liveStatuses } })
            .populate('employee', 'name employeeCode department profileImageUrl')
            .populate('timeline.actionBy', 'name profileImageUrl')
            .sort({ priority: -1, createdAt: -1 }) // High priority pinned first
            .exec();

        return this.filterComplaintsBySearch(complaints, searchQuery);
    }

    // ─── GET HISTORICAL COMPLAINTS FOR DIRECTOR ───
    async getDirectorHistoryComplaints(searchQuery?: string) {
        const historicalStatuses = ['Resolved', 'Rejected', 'Withdrawn'];

        const complaints = await this.complaintModel
            .find({ status: { $in: historicalStatuses } })
            .populate('employee', 'name employeeCode department profileImageUrl')
            .populate('timeline.actionBy', 'name profileImageUrl')
            .sort({ updatedAt: -1, createdAt: -1 })
            .exec();

        return this.filterComplaintsBySearch(complaints, searchQuery);
    }


}