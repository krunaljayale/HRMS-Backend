import { IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsUrl } from 'class-validator';

export class UpsertAlertDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  buttonText?: string;

  @IsOptional()
  @IsUrl()
  buttonLink?: string;

  @IsOptional()
  @IsBoolean()
  isSkippable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(['force_update', 'optional_update', 'info', 'promo', 'maintenance'])
  type?: string;

  @IsEnum(['android', 'ios', 'both'])
  platform!: string;

  @IsOptional()
  @IsNumber()
  minimumVersionCode?: number;

  @IsOptional()
  @IsNumber()
  maximumVersionCode?: number;
}