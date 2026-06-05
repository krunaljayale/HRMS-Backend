import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Complaint } from './schemas/complaint.schema';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';

@Injectable()
export class ComplaintService {
    constructor(
        @InjectModel(Complaint.name) private complaintModel: Model<Complaint>,
    ) { }

    // 1. CREATE COMPLAINT
    async create(createComplaintDto: CreateComplaintDto) {
        // Automatically generate the first timeline entry
        const initialTimeline = {
            action: 'Submitted',
            actionBy: createComplaintDto.employee,
            role: 'Employee',
            updatedStatus: 'Pending',
            comments: 'Initial complaint submitted.',
        };

        const newComplaint = new this.complaintModel({
            ...createComplaintDto,
            status: 'Pending',
            timeline: [initialTimeline],
        });

        return await newComplaint.save();
    }

    // 2. GET ALL COMPLAINTS (With Filters)
    async findAll(query: any) {
        const { status, priority, employee } = query;

        // Build query dynamically
        const filter: any = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (employee) filter.employee = employee;

        return await this.complaintModel
            .find(filter)
            .sort({ createdAt: -1 }) // Newest first
            // Populate employee details for the UI
            .populate('employee', 'name profileImageUrl department')
            // Populate timeline actor details
            .populate('timeline.actionBy', 'name profileImageUrl');
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

        // Determine the exact action name
        let action = 'Commented';
        if (previousStatus !== updateDto.status) {
            action = updateDto.status; // e.g., "Acknowledged", "Resolved", etc.
        } else if (!updateDto.comments) {
            throw new BadRequestException('Provide a comment or change the status.');
        }

        // Build the new timeline event
        const newTimelineEntry = {
            action,
            actionBy: updateDto.actionBy,
            role: updateDto.role,
            comments: updateDto.comments || '',
            previousStatus,
            updatedStatus: updateDto.status,
        };

        // Update main document status
        complaint.status = updateDto.status;

        // Push event to timeline array
        complaint.timeline.push(newTimelineEntry as any);

        // Save Director comments specifically if it was a Director taking action
        if (updateDto.role === 'Director' && updateDto.comments) {
            complaint.directorComments = updateDto.comments;
        }

        return await complaint.save();
    }
}