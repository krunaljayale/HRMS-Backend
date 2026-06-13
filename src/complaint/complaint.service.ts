import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
}