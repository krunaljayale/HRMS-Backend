import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export class UpdateFcmTokenDto {
    @IsString()
    @IsNotEmpty()
    fcmToken!: string;

    @IsString()
    @IsNotEmpty()
    @IsEnum(['android', 'ios'])
    deviceType!: string;

    @IsString()
    @IsNotEmpty()
    deviceId!: string;
}