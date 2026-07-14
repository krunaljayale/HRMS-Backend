import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Holiday } from './schemas/holiday.schema';
import { CreateHolidayDto } from './dto/create-holiday.dto';

@Injectable()
export class HolidayService {
    constructor(
        @InjectModel(Holiday.name) private holidayModel: Model<Holiday>,
    ) { }

    async create(createHolidayDto: CreateHolidayDto, adminId: string) {
        const holidayDate = new Date(createHolidayDto.date);
        const year = holidayDate.getFullYear();

        try {
            const newHoliday = new this.holidayModel({
                ...createHolidayDto,
                date: holidayDate,
                year: year,
                createdBy: adminId, // Injected securely from token
                isActive: true,
            });

            return await newHoliday.save();
        } catch (error: any) {
            if (error.code === 11000) {
                throw new ConflictException('This exact holiday already exists on this date.');
            }
            throw error;
        }
    }

    // Frontend will mostly use this to get a specific year's calendar
    async findAllByYear(year: number) {
        return await this.holidayModel
            .find({ year, isActive: true })
            .sort({ date: -1 })
            .populate('createdBy', 'name');
    }

    // SOFT DELETE
    async softDelete(id: string) {
        const holiday = await this.holidayModel.findByIdAndUpdate(
            id,
            { isActive: false },
            { new: true }
        );

        if (!holiday) {
            throw new NotFoundException('Holiday not found');
        }

        return { message: 'Holiday successfully removed from calendar.' };
    }

    async checkIsHoliday(dateString: string): Promise<boolean> {
        const holiday = await this.holidayModel.findOne({
            date: {
                $gte: new Date(`${dateString}T00:00:00.000Z`),
                $lte: new Date(`${dateString}T23:59:59.999Z`)
            },
            isActive: true
        });
        return !!holiday; // Returns true if found, false if not
    }

    // Fetch all active holidays for a specific month to build calendars
    async findHolidaysByMonth(year: number, month: number) {
        // Note: JS Date months are 0-indexed, so month - 1
        // We use UTC to match how you store them in checkIsHoliday
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

        return await this.holidayModel.find({
            date: { $gte: startDate, $lte: endDate },
            isActive: true
        }).lean();
    }

    // ── PAYROLL ENGINE HELPER: FETCH HOLIDAYS IN RANGE ──
    async findHolidaysInRange(fromDate: Date, toDate: Date, session?: ClientSession): Promise<Holiday[]> {
        return await this.holidayModel
            .find({
                date: {
                    $gte: fromDate,
                    $lte: toDate,
                },
                isActive: true, // Crucial: Ensures canceled holidays are not processed in payroll
            })
            .session(session || null) // Safely inject the session into the chain
            .sort({ date: 1 }) // Sorted chronologically
            .lean(); // Using .lean() for faster, lightweight plain JS objects since we don't need Mongoose instance methods here
    }
}