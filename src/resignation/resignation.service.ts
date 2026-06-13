import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ResignationDocument } from './schemas/resignation.schema';
import { ApplyResignationDto } from './dto/apply-resignation.dto';

@Injectable()
export class ResignationService {
    constructor(
        @InjectModel('Resignation') private resignationModel: Model<ResignationDocument>,
    ) { }

    // 1. APPLY FOR RESIGNATION
    async applyResignation(employeeId: string, dto: ApplyResignationDto) {
        // Prevent duplicate active submissions
        const existingResignation = await this.resignationModel.findOne({
            employeeId: new Types.ObjectId(employeeId),
            overallStatus: { $in: ['Pending', 'Approved'] }
        });

        if (existingResignation) {
            throw new BadRequestException('You already have an active resignation request.');
        }

        // Hardcoded Route: HR ➔ Director
        const resignationRoute = [
            { isHRProfileStep: true, isDirectorProfileStep: false, status: 'Pending' },
            { isHRProfileStep: false, isDirectorProfileStep: true, status: 'Pending' }
        ];

        const newResignation = await this.resignationModel.create({
            employeeId: new Types.ObjectId(employeeId),
            reason: dto.reason,
            requestedLastWorkingDay: new Date(dto.requestedLastWorkingDay),
            workflowSteps: resignationRoute,
            currentStepIndex: 0,
            overallStatus: 'Pending'
        });

        return newResignation;
    }

    // 2. FETCH RESIGNATION HISTORY
    async getMyResignations(employeeId: string) {
        const resignations = await this.resignationModel
            .find({ employeeId: new Types.ObjectId(employeeId) })
            .sort({ createdAt: -1 }) // Newest first
            .exec();

        return resignations;
    }

    // 3. WITHDRAW RESIGNATION
    async withdrawResignation(employeeId: string, resignationId: string) {
        const resignation = await this.resignationModel.findOne({
            _id: new Types.ObjectId(resignationId),
            employeeId: new Types.ObjectId(employeeId)
        });

        if (!resignation) {
            throw new NotFoundException('Resignation request not found.');
        }

        // Prevent withdrawing requests that are already finalized
        if (['Rejected', 'Withdrawn'].includes(resignation.overallStatus)) {
            throw new BadRequestException(`This request is already ${resignation.overallStatus.toLowerCase()} and cannot be modified.`);
        }

        // Change the global status to Withdrawn
        resignation.overallStatus = 'Withdrawn';

        // Mark the current active workflow step as Cancelled so it drops off HR/Director dashboards
        if (resignation.workflowSteps && resignation.workflowSteps[resignation.currentStepIndex]) {
            resignation.workflowSteps[resignation.currentStepIndex].status = 'Cancelled';
        }

        await resignation.save();

        return resignation;
    }
}