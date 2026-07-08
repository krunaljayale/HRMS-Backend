import {
  IsOptional,
  IsString,
  IsBooleanString,
} from 'class-validator';

export class GetPayrollListQueryDto {

  @IsOptional()
  @IsString()
  search?: string;

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
  @IsString()
  status?: string;

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
