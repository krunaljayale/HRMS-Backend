import { IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsUrl, ValidateIf } from 'class-validator';

export class CreateVideoDto {
    @IsString()
    title!: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsUrl()
    videoUrl!: string;

    @IsEnum(['youtube', 'direct'])
    videoType!: 'youtube' | 'direct';

    // FIX: Only apply @IsUrl if the string is NOT empty
    @ValidateIf(o => o.thumbnail !== '')
    @IsUrl()
    @IsOptional()
    thumbnail?: string;

    @IsNumber()
    @IsOptional()
    duration?: number;

    @IsBoolean()
    isActive!: boolean;
}

export class UpdateVideoDto extends CreateVideoDto { }