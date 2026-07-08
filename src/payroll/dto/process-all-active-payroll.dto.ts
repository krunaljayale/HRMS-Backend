import { IsNotEmpty, IsNumber, IsString, Min, Max } from 'class-validator';

export class ProcessAllActivePayrollDto {
  @IsNotEmpty()
  @IsString()
  fromDate!: string; // Expects YYYY-MM-DD or ISO string

  @IsNotEmpty()
  @IsString()
  toDate!: string; // Expects YYYY-MM-DD or ISO string

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(12)
  targetMonth!: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(2000)
  targetYear!: number;
}