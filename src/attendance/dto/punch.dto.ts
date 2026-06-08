import { IsNumber, IsEnum, IsOptional, IsString, IsArray } from 'class-validator';

export class CheckInDto {
    @IsNumber()
    @IsOptional() // Optional because WFH might not send strict coords
    latitude?: number;

    @IsNumber()
    @IsOptional()
    longitude?: number;

    @IsEnum(['Office', 'Field', 'WFH'])
    workMode!: string;
}

export class CheckOutDto extends CheckInDto {
    @IsString()
    @IsOptional()
    todayWork?: string;

    @IsString()
    @IsOptional()
    pendingWork?: string;

    @IsString()
    @IsOptional()
    issuesFaced?: string;

    @IsArray()
    @IsString({ each: true }) // Validates that every item inside the array is a string
    @IsOptional()
    reportParticipants!: string[];
}