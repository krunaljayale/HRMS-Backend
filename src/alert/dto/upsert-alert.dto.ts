import { IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsUrl, ValidateIf } from 'class-validator';

export class UpsertAlertDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @ValidateIf(o => o.buttonLink !== '' && o.buttonLink !== undefined && o.buttonLink !== null)
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  buttonText?: string;

  @ValidateIf(o => o.buttonLink !== '' && o.buttonLink !== undefined && o.buttonLink !== null)
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

  // Technical fields remain optional so the Web Portal doesn't need to send them
  @IsOptional()
  @IsNumber()
  minimumVersionCode?: number;

  @IsOptional()
  @IsNumber()
  maximumVersionCode?: number;
}