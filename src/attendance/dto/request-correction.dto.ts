// dto/request-correction.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CorrectionRequestDto {
    @IsString()
    @IsNotEmpty()
    reason!: string;

    @IsDateString()
    @IsNotEmpty()
    requestedInTime!: string;

    @IsDateString()
    @IsNotEmpty()
    requestedOutTime!: string;

    @IsString()
    @IsOptional()
    proofUrl?: string;
}