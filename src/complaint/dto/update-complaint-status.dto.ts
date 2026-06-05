import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class UpdateComplaintStatusDto {
  @IsEnum(['Pending', 'Acknowledged', 'In Review', 'Resolved', 'Rejected'])
  status!: string;

  @IsString()
  @IsNotEmpty()
  actionBy!: string; // The ID of the HR/Director making the update

  @IsString()
  @IsNotEmpty()
  role!: string; // E.g., 'HR' or 'Director'

  @IsOptional()
  @IsString()
  comments?: string;
}