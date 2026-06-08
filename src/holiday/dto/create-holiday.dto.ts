import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  @IsNotEmpty()
  date!: string; // ISO Date string from the frontend

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(['National', 'Company-specific'])
  type!: string;

  @IsOptional()
  @IsString()
  description?: string;
}