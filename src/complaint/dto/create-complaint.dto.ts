import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';

export class CreateComplaintDto {

  @IsOptional() // Add this so the pipeline doesn't block the request
  @IsString()
  employee?: string; //  Make it optional with the question mark

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsEnum(['Work Environment', 'Harassment', 'Discrimination', 'Management', 'Policy Violation', 'Facilities', 'Other'])
  category!: string;

  @IsOptional()
  @IsEnum(['Low', 'Medium', 'High'])
  priority?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}