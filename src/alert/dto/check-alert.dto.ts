import { IsEnum, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckAlertDto {
  @ApiProperty({ 
    description: 'The platform the mobile app is running on', 
    enum: ['android', 'ios','both'],
    example: 'android'
  })
  @IsEnum(['android', 'ios','both'])
  platform!: string;

  @ApiProperty({ 
    description: 'The current build version code of the mobile app', 
    example: 15 
  })
  @IsNumber()
  versionCode!: number;
}                                  