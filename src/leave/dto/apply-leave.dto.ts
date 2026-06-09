import {
    IsString,
    IsNotEmpty,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsArray,
    IsIn,
    Matches,
    IsMongoId
} from 'class-validator';

export class ApplyLeaveDto {
    @IsString()
    @IsNotEmpty()
    leaveCategory!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
    startDate!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
    endDate!: string;

    @IsNumber()
    @IsNotEmpty()
    totalDays!: number;

    @IsBoolean()
    @IsOptional()
    isHalfDay?: boolean;

    @IsString()
    @IsOptional()
    @IsIn(['Morning', 'Afternoon', '']) // Strict validation for the shift
    halfDayPeriod?: string;

    @IsString()
    @IsNotEmpty()
    reason!: string;

    // Validates that the payload is an array of actual MongoDB ID strings
    @IsArray()
    @IsMongoId({ each: true })
    @IsOptional()
    consumedLedgerIds?: string[];
}