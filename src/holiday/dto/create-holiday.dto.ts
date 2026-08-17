import { IsNotEmpty, IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';

export class CreateHolidayDto {
  @IsNotEmpty()
  @IsDateString()
  date!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsEnum(['National', 'Company-specific'], {
    message: 'Type must be either "National" or "Company-specific"',
  })
  type!: 'National' | 'Company-specific';

  @IsOptional()
  @IsString()
  description?: string;
}