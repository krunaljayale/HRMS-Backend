import {
  IsOptional,
  IsString,
  IsEnum,
  IsBooleanString,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetPayrollListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year?: number;

  @IsOptional()
  @IsEnum(['Draft', 'Processed', 'Paid'])
  status?: string;

  @IsOptional()
  @IsString()
  startDate?: string; // Expects YYYY-MM-DD

  @IsOptional()
  @IsString()
  endDate?: string; // Expects YYYY-MM-DD

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsBooleanString()
  self?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
