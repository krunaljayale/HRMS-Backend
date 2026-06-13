// apply-resignation.dto.ts
import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class ApplyResignationDto {
    @IsString()
    @IsNotEmpty()
    reason!: string;

    @IsDateString()
    @IsNotEmpty()
    requestedLastWorkingDay!: string;
}