// src/reimbursement/reimbursement.service.ts

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Reimbursement, ReimbursementDocument } from './schemas/reimbursement.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { EmployeeService } from '../employee/employee.service';

@Injectable()
export class ReimbursementService {
    constructor(
        @InjectModel(Reimbursement.name)
        private readonly reimbursementModel: Model<ReimbursementDocument>,
        private readonly cloudinaryService: CloudinaryService,
        private readonly employeeService: EmployeeService,
    ) { }

    /**
     * Processes a new reimbursement submission originating from the mobile app application layer.
     */
    async createFromApp(
        employeeId: string,
        payload: {
            amount: number;
            reason: string;
            expenseDate: Date;
            file: Express.Multer.File;
        },
    ) {
        let uploadedProofUrl = '';

        const employee = await this.employeeService.getEmployeeById(employeeId, 'employeeCode');

        // 1. Process the receipt image upload via your standard Cloudinary pipeline
        if (payload.file) {
            try {
                const uploadResult = await this.cloudinaryService.uploadFile(
                    payload.file,
                    `reimbursement_proofs/${employee.employeeCode}`,
                );
                uploadedProofUrl = uploadResult.secure_url;
            } catch (error) {
                console.error('Cloudinary reimbursement upload bottleneck error:', error);
                throw new BadRequestException('File upload failed for receipt proof');
            }
        } else {
            throw new BadRequestException('Physical receipt proof file is missing');
        }

        // 2. Apply defensive data-type casting and structure matching your schema rules
        const sanitizedData = {
            employeeId: new Types.ObjectId(employeeId),
            amount: payload.amount,
            reason: payload.reason ? String(payload.reason).trim() : '',
            expenseDate: payload.expenseDate,
            imageProofUrl: uploadedProofUrl,

            // Implicitly initialize foundational status properties
            hrStatus: 'Pending',
            paymentStatus: 'Unpaid',
        };

        // 3. Database invocation instantiation and execution save block
        try {
            const newReimbursement = new this.reimbursementModel(sanitizedData);
            return await newReimbursement.save();
        } catch (dbError: any) {
            console.error('Mongoose reimbursement collection pipeline error details:', dbError);
            throw new BadRequestException(
                `Database persistence failed: ${dbError.message}`,
            );
        }
    }

    async getEmployeeHistory(employeeId: string) {
        try {
            const history = await this.reimbursementModel
                .find({ employeeId: new Types.ObjectId(employeeId) })
                .sort({ createdAt: -1 }) // Sort descending: newest claims at the top
                .lean() // Use .lean() for faster read-only queries
                .exec();

            // Wrap in standard 'data' object so your frontend hook parses it easily
            return { success: true, data: history };
        } catch (error: any) {
            console.error('Failed to fetch employee reimbursement history:', error);
            throw new BadRequestException('Could not load reimbursement history');
        }
    }

    // Add this method to the service class
    async cancelEmployeeClaim(claimId: string, employeeId: string) {
        // 1. Find the claim and ensure it belongs to this exact user
        const claim = await this.reimbursementModel.findOne({
            _id: new Types.ObjectId(claimId),
            employeeId: new Types.ObjectId(employeeId),
        });

        if (!claim) {
            throw new BadRequestException('Claim not found or you do not have permission to delete it');
        }

        // 2. The Golden Rule: Only allow deletion if HR hasn't processed it yet
        if (claim.hrStatus !== 'Pending') {
            throw new BadRequestException(`Cannot cancel a claim that is already ${claim.hrStatus}`);
        }

        // 3. Delete the document
        await this.reimbursementModel.findByIdAndDelete(claim._id);

        return { success: true, message: 'Claim cancelled successfully' };
    }

    async getPendingClaimsForHr() {
        try {
            const pendingClaims = await this.reimbursementModel
                .find({ hrStatus: 'Pending' })
                .populate('employeeId', 'name code') // Hydrate the reference with name and code properties
                .sort({ createdAt: 1 }) // First in, first out (oldest pending items first)
                .lean()
                .exec();

            // Map the array to perfectly match the frontend's expected { employee: { name, code } } structure
            const formattedClaims = pendingClaims.map((claim: any) => {
                const { employeeId, ...rest } = claim;
                return {
                    ...rest,
                    employee: employeeId ? { name: employeeId.name, code: employeeId.code } : { name: 'Unknown', code: 'N/A' },
                };
            });

            return { success: true, data: formattedClaims };
        } catch (error) {
            console.error('Failed to query pending HR inbox claims:', error);
            throw new BadRequestException('Could not retrieve pending claims list');
        }
    }

    // NEW: Approve an incoming claim
    async approveClaimByHr(claimId: string, hrId: string) {
        const claim = await this.reimbursementModel.findById(claimId);

        if (!claim) {
            throw new NotFoundException('Reimbursement claim record not found');
        }

        if (claim.hrStatus !== 'Pending') {
            throw new BadRequestException(`This claim cannot be approved because it has already been processed as ${claim.hrStatus}`);
        }

        claim.hrStatus = 'Approved';
        claim.processedBy = new Types.ObjectId(hrId);

        const updatedDoc = await claim.save();
        return { success: true, data: updatedDoc };
    }

    // NEW: Reject an incoming claim with a mandatory reason
    async rejectClaimByHr(claimId: string, hrId: string, rejectionReason: string) {
        if (!rejectionReason || !rejectionReason.trim()) {
            throw new BadRequestException('A descriptive rejection reason is mandatory to reject a claim');
        }

        const claim = await this.reimbursementModel.findById(claimId);

        if (!claim) {
            throw new NotFoundException('Reimbursement claim record not found');
        }

        if (claim.hrStatus !== 'Pending') {
            throw new BadRequestException(`This claim cannot be rejected because it has already been processed as ${claim.hrStatus}`);
        }

        claim.hrStatus = 'Rejected';
        claim.rejectionReason = rejectionReason.trim();
        claim.processedBy = new Types.ObjectId(hrId);

        const updatedDoc = await claim.save();
        return { success: true, data: updatedDoc };
    }

    async getHistoricalClaimsForHr() {
        try {
            const historicalClaims = await this.reimbursementModel
                .find({ hrStatus: { $in: ['Approved', 'Rejected'] } })
                .populate('employeeId', 'name code') // Hydrate employee data fields
                .sort({ updatedAt: -1 }) // Show most recently processed items first
                .lean()
                .exec();

            // Reformat payload matching frontend's expectations
            const formattedClaims = historicalClaims.map((claim: any) => {
                const { employeeId, ...rest } = claim;
                return {
                    ...rest,
                    employee: employeeId ? { name: employeeId.name, code: employeeId.code } : { name: 'Unknown', code: 'N/A' },
                };
            });

            return { success: true, data: formattedClaims };
        } catch (error) {
            console.error('Failed to query historical HR ledger claims:', error);
            throw new BadRequestException('Could not retrieve historical processed claims ledger');
        }
    }

    // ------------------------------------For Payroll Service START------------------------------------- //
    // Fetch approved claims that haven't been paid out yet, up to the end of the payroll cycle
    async getApprovedUnpaidClaims(
        employeeId: string,
        toDate: Date,
        existingPayrollId?: Types.ObjectId // <-- Added optional 3rd argument
    ) {
        const query: any = {
            employeeId: new Types.ObjectId(employeeId),
            hrStatus: 'Approved',
            createdAt: { $lte: toDate }, // Ensures we don't accidentally sweep claims made *after* the cycle ends
        };

        // If checking a preview for an existing payroll, fetch Unpaid + claims paid by this exact payroll
        if (existingPayrollId) {
            query.$or = [
                { paymentStatus: 'Unpaid' },
                { payrollId: existingPayrollId }
            ];
        } else {
            // Standard generation behavior: just get Unpaid claims
            query.paymentStatus = 'Unpaid';
        }

        return await this.reimbursementModel.find(query).lean().exec();
    }

    // Mark claims as paid and link the payroll document ID
    async markClaimsAsPaid(claimIds: Types.ObjectId[], payrollId: Types.ObjectId, session?: ClientSession) {
        if (!claimIds || claimIds.length === 0) return;

        await this.reimbursementModel.updateMany(
            { _id: { $in: claimIds } },
            {
                $set: {
                    paymentStatus: 'Paid',
                    payrollId: payrollId,
                },
            },
            { session }, // Apply session
        );
    }

    // Release claims back to Unpaid if a payroll calculation is re-run
    async resetClaimsByPayrollId(payrollId: Types.ObjectId, session?: ClientSession) {
        if (!payrollId) return;

        await this.reimbursementModel.updateMany(
            { payrollId: payrollId },
            {
                $set: {
                    paymentStatus: 'Unpaid',
                },
                $unset: {
                    payrollId: '',
                },
            },
            { session }, // Apply session
        );
    }

    // Fetch multiple reimbursement documents by their ObjectIds
    async findManyByIds(claimIds: Types.ObjectId[]) {
        if (!claimIds || claimIds.length === 0) {
            return [];
        }

        return await this.reimbursementModel.find({
            _id: { $in: claimIds }
        }).lean().exec();
    }

    async getClaimsForPayrollCalculation(
        employeeId: string,
        toDate: Date,
        existingPayrollId?: Types.ObjectId,
        session?: ClientSession
    ) {
        const query: any = {
            employeeId: new Types.ObjectId(employeeId),
            hrStatus: 'Approved',
            createdAt: { $lte: toDate },
        };

        // If a payroll exists, fetch Unpaid claims OR claims already paid by this exact payroll
        if (existingPayrollId) {
            query.$or = [
                { paymentStatus: 'Unpaid' },
                { payrollId: existingPayrollId }
            ];
        } else {
            query.paymentStatus = 'Unpaid';
        }

        return await this.reimbursementModel.find(query).session(session || null).lean().exec();
    }

    // Fetch all claims that were paid out in a specific payroll cycle
    async findPaidClaimsByPayrollId(payrollId: Types.ObjectId) {
        if (!payrollId) return [];

        return await this.reimbursementModel.find({
            payrollId: payrollId,
            paymentStatus: 'Paid'
        }).lean().exec();
    }
    // ------------------------------------For Payroll Service END------------------------------------- //
}