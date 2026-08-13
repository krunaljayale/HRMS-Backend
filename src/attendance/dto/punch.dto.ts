import { IsNumber, IsEnum, IsOptional, IsString, IsArray } from 'class-validator';
import { Types } from 'mongoose';

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

export class CheckOutDto {
    @IsNumber()
    @IsOptional()
    latitude?: number;

    @IsNumber()
    @IsOptional()
    longitude?: number;

    @IsString()
    @IsOptional()
    todayWork?: string;

    @IsString()
    @IsOptional()
    pendingWork?: string;

    @IsString()
    @IsOptional()
    issuesFaced?: string;

    // ONLY EXPECT A SINGLE STRING NOW
    @IsString()
    @IsOptional()
    reportParticipant!: Types.ObjectId;
}