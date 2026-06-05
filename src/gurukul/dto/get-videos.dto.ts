import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GetVideosDto {
    @IsOptional()
    @Type(() => Number) // Forces query strings (e.g. "?page=2") into real numbers
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50) // Prevents the frontend from requesting 10,000 videos at once
    limit?: number = 10;

    @IsOptional()
    @IsString()
    search?: string;
}