import { Types } from 'mongoose';

export interface IWorkflowStep {
    approverId?: Types.ObjectId;
    isHRProfileStep?: boolean;
    isDirectorProfileStep?: boolean;
    status: 'Pending' | 'Approved' | 'Rejected';
    actedById?: Types.ObjectId;
    actedAt?: Date;
    remarks?: string;
}